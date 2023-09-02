const aircode = require('aircode');
const axios = require('axios');
const openai = require("openai");

const { store } = require('./config');
const { replyMessage, sendMessage, userConfig, runtimeLog } = require('./server');

// 从环境变量中获取 OpenAI 的 Secret
const OpenAISecret = store.OpenAISecret;
let chatGPT = null;

if (OpenAISecret) {
    // 与 ChatGTP 聊天的方法，传入字符串即可
    const configuration = new openai.Configuration({ apiKey: OpenAISecret });
    const client = new openai.OpenAIApi(configuration);
    chatGPT = async (content, mode) => {
        let max_tokens = mode == 0 ? 3500 : 2500;
        try {
            const res = await client.createChatCompletion({
                model: 'gpt-3.5-turbo',
                messages: content,
                temperature: 0.9,
                max_tokens: max_tokens
            });
            return {
                reply: res.data.choices[0].message.content.trim(),
                usage: res.data.usage.total_tokens,
                status: 'success'
            };
        } catch (error) {
            return {
                reply: `-- [Error in OpenAi] --\n请clear消息缓存后重试\n\n${error}`,
                status: 'error',
                usage: 0
            }
        }
    };
}


const basePreStr = store.prompt.basePreset;
const userInstructions = store.instruction;

const runChat = async (msg, openId) => {
    const operationMap = [
        [ // 清空消息历史
            () => msg === '/clear',
            async () => await clearHistory(openId)
        ],
        [ // 人格预设
            () => msg.startsWith('/preset'),
            async () => await presetRole(msg, openId)
        ],
        [ // 恢复初始预设
            () => msg.startsWith('/init'),
            async () => await presetRole(basePreStr, openId)
        ],
        [ // 展示帮助命令
            () => msg === '/help',
            async () => await sendHelpText(openId)
        ],
        [ // 连续对话
            () => msg === '/plus',
            async () => await switchMode(openId, 1)
        ],
        [ // 单次对话
            () => msg === '/once',
            async () => await switchMode(openId, 0)
        ],
        [
            () => msg === '/get',
            async () => await getMsgHis(openId)
        ]
    ]
    const handleFun = operationMap.find(item => item[0]())
    if (handleFun)
        return await handleFun[1]();

    // 预设初始值
    let msgArr = [{ "role": "system", "content": basePreStr }]
    let replyContent = '';

    // 查询数据库中是否存在记录,已存在则替代初始值
    const hisObj = await userConfig.where({ openId }).findOne();
    if (hisObj)
        msgArr = Object.values(hisObj.chatHistory);

    // 单次对话模式
    if (hisObj && hisObj.dialogMode === 0) {
        // 单条消息长度不能超过2000
        if (msg.length >= 2000)
            return "消息太长啦~\n笨蛋哆啦理解不了!🏳️"
        msgArr = [{ "role": "system", "content": basePreStr }, { "role": "user", "content": msg }];
    }
    // 连续对话模式
    else {
        if (msg.length >= 1500)
            return "消息太长啦~\n笨蛋哆啦理解不了!🏳️";

        // 长度超限处理
        const str = msgArr.map(item => {
            return item.content;
        }).join('\n');
        if (str.length + msg.length >= 1500) {
            const summaryPrompt = '简要总结一下对话内容，用作后续的上下文提示 prompt，控制在 200 字以内';
            msgArr.push({ "role": "user", "content": summaryPrompt });
            const summaryMsg = await chatGPT(msgArr);
            msgArr = [
                { "role": "system", "content": hisObj.systemRole },
                { "role": "assistant", "content": summaryMsg.reply }
            ]
            if (summaryMsg.status == 'error')
                return summaryMsg.reply;
        }
        msgArr.push({ "role": "user", "content": msg });
    }
    const tmpMode = hisObj ? hisObj.dialogMode : 0;
    const res = await chatGPT(msgArr, tmpMode);

    // 调用ChatGPT接口出错时抛出错误
    if (res.status == 'error')
        return res.reply;

    replyContent = res.reply;
    msgArr.push({ "role": "assistant", "content": replyContent });

    try {
        if (hisObj) {
            // 更新消息记录
            if (hisObj.dialogMode === 1)
                hisObj.chatHistory = msgArr;
            await userConfig.save(hisObj);
        } else {
            await userConfig.save({
                openId: openId,
                chatHistory: msgArr,
                systemRole: basePreStr,
                dialogMode: 1
            });
        }
        return replyContent;
    } catch (err) {
        console.error(`-- [Error in runChat] --\n${err}`);
        return err;
    }
}

/**
 * 发送帮助信息
 * @param {String} openId - 用户id
 */
async function sendHelpText(openId) {
    let dictContent = { ...userInstructions };
    let content = Object.keys(dictContent).map(key => {
        return `<b>\/${key}</b>:${dictContent[key]}`;
    }).join('\\n');
    content = "所有命令:\\n" + content;
    await sendMessage(openId, 'text', `{"text":"${content}"}`)
    return 'SILENT';
}

/**
 * 在数据库中初始化用户个人信息
 * @param {String} openId - 用户id
 * @param {String} systemRole - 用户预设
 * @param {Number} dialogMode - 对话模式
 * @returns 
 */
async function initUserInfo(openId, systemRole = basePreStr, dialogMode = 1) {
    try {
        await userConfig.save({
            openId: openId,
            systemRole,
            dialogMode,
            chatHistory: [{ "role": "system", "content": basePreStr }],
        });
    } catch {
        console.error('--初始化用户信息出错--');
        return;
    }
}

/**
 * 清除消息记录(保留预设)
 * @param {String} openId - 用户id
 */
async function clearHistory(openId) {
    try {
        const hisObj = await userConfig.where({ openId }).findOne();
        if (hisObj) {
            hisObj.chatHistory = [{ "role": "system", "content": hisObj.systemRole }];
            await userConfig.save(hisObj);
        } else {
            await initUserInfo(openId);
        }
        return "对话历史已清空✨"
    } catch {
        console.error('--清除历史记录出错--');
        return "出错啦!请稍后再试";
    }
}

/**
 * 预设人格并清除聊天记录
 * @param {String} msg - 消息内容 
 * @param {String} openId - 用户id
 */
async function presetRole(msg, openId) {
    try {
        const systemRole = msg.replace('/preset', '').trim();
        const hisObj = await userConfig.where({ openId }).findOne();
        if (!hisObj || (hisObj && hisObj.dialogMode == 0))
            return "请先进入对话模式"

        if (hisObj) {
            hisObj.chatHistory = [{ "role": "system", "content": systemRole }];
            hisObj.systemRole = systemRole;
            await userConfig.save(hisObj);
        } else {
            await initUserInfo(openId, systemRole);
        }
        if (msg == basePreStr)
            return "已恢复默认状态🍰"
        return "预设成功🍧";
    } catch (err) {
        console.error('--预设人格出错--');
        return "出错啦!请稍后再试";
    }
}

/**
 * 切换对话模式
 * @param {String} openId - 用户id 
 * @param {Number} mode - 模式，0表示单次对话模式，1表示上下文对话模式
 */
async function switchMode(openId, mode) {
    try {
        const hisObj = await userConfig.where({ openId }).findOne();
        if (hisObj) {
            if (mode === 1)
                await presetRole(basePreStr, openId);
            hisObj.dialogMode = mode;
            await userConfig.save(hisObj);
        } else {
            await initUserInfo(openId, basePreStr, mode);
        }
        if (mode === 1)
            return "-- 已进入连续对话模式 --";
        else
            return "-- 已进入单次对话模式 --";
    } catch {
        console.error('--切换对话模式出错--');
        return "出错啦!请稍后再试";
    }
}


module.exports = async function (params, context) {
    // 判断是否开启了事件 Encrypt Key，如果开启提示错误
    if (params.encrypt) return { error: '请在飞书机器人配置中移除 Encrypt Key。' }

    // 用来做飞书接口校验，飞书接口要求有 challenge 参数时需直接返回
    if (params.challenge) return { challenge: params.challenge };

    // 判断是否没有开启事件相关权限，如果没有开启，则返回错误
    if (!params.header || !params.header.event_id) {
        // 判断当前是否为通过 Debug 环境触发
        if (context.trigger === 'DEBUG') {
            return { error: '如机器人已配置好，请先通过与机器人聊天测试，再使用「Mock by online requests」功能调试。' };
        } else {
            return { error: '请参考教程配置好飞书机器人的事件权限，相关权限需发布机器人后才能生效。' };
        }
    }

    // 飞书机器人每条用户消息都会有 event_id
    const eventId = params.header.event_id;
    // 搜索 runtime 表中是否有 eventId 与当前这次一致的
    const tmpLog = await runtimeLog.where({ eventId }).findOne();
    // 如果 tmpLog 有值，则代表这条 event 出现过
    // 由于 ChatGPT 返回时间较长，这种情况可能是飞书系统的重试，直接 return 掉，防止重复调用
    // 如果当前环境为 DEBUG 环境时，这条不生效，方便调试
    if (tmpLog && context.trigger !== 'DEBUG') return;

    // 获取基本信息
    const message = params.event.message;
    const msgType = message.message_type;
    const sender = params.event.sender;
    const openId = sender.sender_id.open_id;

    // 返回给用户的消息
    let replyContent = '';

    // 目前 ChatGPT 仅支持文本内容
    if (msgType === 'text') {
        // 获取用户消息与预处理
        replyContent = await preOperation(message.content, openId, eventId);
        // 如果配置了 OpenAI Key 则让 ChatGPT 回复
        if (OpenAISecret) {
            // 将用户具体消息发送给 ChatGPT,将获取到的 ChatGPT 回复给用户
            replyContent = await runChat(replyContent, sender.sender_id.open_id);
        }
    } else
        replyContent = 'Sorry~ 暂时不支持非文本类型的消息哦😜';

    if (replyContent == 'SILENT') return null;

    await runtimeLog.where({ eventId }).set({ reply: replyContent }).save();
    // 将处理后的消息通过飞书机器人发送给用户
    await replyMessage(message.message_id, 'text', JSON.stringify({ text: replyContent }));

    // 整个函数调用结束，需要有返回
    return null;
}

/**
 * 消息预处理,初始化聊天日志.
 * @param {Object} message - 飞书事件体结构 
 * @param {*} openId - 发信者id
 * @param {*} eventId - 消息事件id
 * @returns content - 返回相同信息
 */
async function preOperation(message, openId, eventId) {
    let content = JSON.parse(message).text || 'Error In preOperation';
    if (content.indexOf('@_all') >= 0) return;
    content = content.replace('@_user_1 ', '');
    // 记录聊天日志
    await runtimeLog.save({
        input: content,
        reply: content,
        openId: openId,
        eventId
    });
    // 默认将用户发送的内容回复给用户，仅是一个直接返回对话的机器人
    return content;
}


//获取消息记录(废弃)
const getMsgHis = async function (openId) {
    try {
        const hisObj = await userConfig.where({ openId }).findOne();
        const arr = Object.values(hisObj.chatHistory);
        const allHis = arr.map(item => {
            if (item.role === 'system') return `<b>预设</b>: ${item.content}`;
            else if (item.role === 'user') return `<b>user</b>: ${item.content}`;
            else if (item.role === 'assistant') return `<b>dora</b>: ${item.content}`;
        }).join('\n');
        return allHis;
    } catch (err) {
        return `-- [Error in getMsgHis] --\nPlease try again\n\n${error}`;
    }
}

// 获取使用排行(废弃)
// const adminGetInfo = async () => {
//     const users = await userConfig.where().sort({ todayTokens: -1 }).find();
//     let tmpArr = users.map(item => {
//         if (item.todayTokens != 0)
//             return `${item.realName} : ${item.todayTokens}`;
//     }).filter(item => !!item);
//     let maxLen = 0;
//     tmpArr.forEach(item => {
//         if (item.length > maxLen) {
//             maxLen = item.length;
//         }
//     });
//     let result = tmpArr.map(item => {
//         return item.padEnd(maxLen, " ");
//     });
//     return '今日使用排行\n' + result.join('\n');
// }

/**
 * 推送更新信息给所有用户(废弃)
 * @returns Promise 对象
 */
// const sendUpdateMsg = async function () {
//     const userArr = await feishuGetAllValidUser();
//     // const userArr = [adminOpenId];
//     let promises = [];
//     for (user of userArr) {
//         promises.push(feishuSendMsg({
//             receive_id: user,
//             content: `{"type": "template", "data": { "template_id": "${welcomeCardId}"} }`,
//             msg_type: 'interactive'
//         }));
//     }
//     return await Promise.all(promises)
//         .then(res => {
//             return '成功推送更新信息';
//         }).catch(err => {
//             return `-- [Error in sendUpdateMsg] --\n\n${err}`
//         });
// }

// 飞书 ChatGPT 机器人的入口函数
