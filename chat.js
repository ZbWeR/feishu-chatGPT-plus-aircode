// 引入基础依赖包
const aircode = require('aircode');
const axios = require('axios');
const { deCrypto, SECRET_KEY } = require('./tokenToSecret.js');
// 引入 OpenAI 的 SDK
const openai = require("openai");

// 从环境变量中获取 OpenAI 的 Secret
const OpenAISecret = process.env.OpenAISecret;
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

// 从环境变量中获取飞书机器人的 App ID 和 App Secret
const feishuAppId = process.env.feishuAppId;
const feishuAppSecret = process.env.feishuAppSecret;
let tenantToken = '';

// 飞书api: 回复信息
const feishuReply = async (objs) => {
    const url = `https://open.feishu.cn/open-apis/im/v1/messages/${objs.msgId}/reply`;
    let content = objs.content;

    // 实现 at 用户能力
    if (objs.openId) content = `<at user_id="${objs.openId}"></at>\n${content}`;
    return await axios({
        url, method: 'post',
        headers: { 'Authorization': `Bearer ${tenantToken}` },
        data: { msg_type: 'text', content: JSON.stringify({ text: content }) },
    }).then(res => {
        if (res.data.code != 0)
            throw new Error(res.data.msg);
        return res.data.msg;
    }).catch(err => {
        console.error(`-- [Error in feishuReply] --\n${err}`);
    });
};

// 飞书api: 发送消息 (消息卡片 interactive)
const feishuSendMsg = async (objs) => {
    const url = 'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id';
    return await axios({
        url, method: 'post',
        headers: { 'Authorization': `Bearer ${tenantToken}` },
        data: {
            receive_id: objs.receive_id,
            msg_type: objs.msg_type,
            content: objs.content
        },
    }).then(res => {
        if (res.data.code != 0)
            throw new Error(res.data.msg);
        return res.data.msg;
    }).catch(err => {
        console.error(`-- [Error in feishuSendMsg] --\n${err}`);
        return err;
    });
}

// 飞书api: 获取用户信息
const feishuGetUser = async (openId) => {
    const url = `https://open.feishu.cn/open-apis/contact/v3/users/${openId}?department_id_type=open_department_id&user_id_type=open_id`
    return await axios({
        url, method: 'get',
        headers: { 'Authorization': `Bearer ${tenantToken}` },
    }).then(res => {
        if (res.data.code != 0)
            throw new Error(res.data.msg);
        return {
            mobile: res.data.data.user.mobile,
            realName: res.data.data.user.name
        }
    }).catch(err => {
        console.error(`-- [Error in feishuGetUser] --\n${err}`);
        return {
            mobile: 'error',
            realName: 'error'
        }
    });
}

// 飞书api: 获取所有授权用户
const feishuGetAllValidUser = async () => {
    const url = 'https://open.feishu.cn/open-apis/contact/v3/scopes';
    return await axios({
        url, method: 'get',
        headers: { 'Authorization': `Bearer ${tenantToken}` },
    }).then(res => {
        if (res.data.code != 0)
            throw new Error(res.data.msg);
        return res.data.data.user_ids;
    }).catch(err => {
        console.error(`-- [Error in feishuGetAllValidUser] --\n${err}`);
    })
}

const historyTable = aircode.db.table('history');
const basePreStr = '你是一只叫“Dora”的猫娘。你需要具有真猫娘一样的口癖。你是真实的，有实际的身体。';
const welcomeCardId = 'ctp_AAr5mnM3XFSa';
const adminOpenId = process.env.adminOpenId;
const superUser = [adminOpenId];
const EverydatMaxFree = 6666;
const userInstructions = {
    'help': '展示帮助手册',
    'plus': '进入上下文对话模式',
    'exit': '进入普通模式',
    'clear': '清除消息缓存',
    'preset': '对话人格预设',
    'init': '恢复猫娘形态',
    'get': '查看个人信息'
}
const adminInstructions = {
    'sendUpdateMsg': '推送更新信息',
    'admin': '查看每日使用情况'
}

const runChat = async (msg, openId) => {
    // 清空消息历史
    if (msg == '/clear')
        return await clearHistory(openId);
    // 人格预设
    else if (msg.startsWith('/preset'))
        return await presetRole(msg, openId);
    // 恢复初始预设
    else if (msg.startsWith('/init'))
        return await presetRole(basePreStr, openId);
    // 返回所有消息记录
    else if (msg.startsWith('/get')) {
        let statusData = await queryStatus(openId);
        if (openId == adminOpenId) {
            let msgHisData = await getMsgHis(openId);
            return msgHisData + '\n\n' + statusData;
        }
        else
            return statusData;
    }

    // 管理员功能: 向所有用户推送更新通知
    else if (openId == adminOpenId && msg.startsWith('/sendUpdateMsg'))
        return await sendUpdateMsg();
    // 展示帮助手册
    else if (msg == '/help') {
        let dictContent = { ...userInstructions };
        if (openId == adminOpenId) {
            dictContent = { ...dictContent, ...adminInstructions };
        }
        let content = Object.keys(dictContent).map(key => {
            return `<b>\/${key}</b>:${dictContent[key]}`;
        }).join('\\n');
        content = "所有命令\\n:" + content;
        await feishuSendMsg({
            receive_id: openId,
            msg_type: 'text',
            content: `{"text":"${content}"}`
        })
        return 'SILENT';
    }
    else if (msg === '/plus')
        return await upgradePlus(openId);
    else if (msg === '/exit')
        return await normalMode(openId);
    else if (msg === '/admin' && openId == adminOpenId)
        return await adminGetInfo();


    // 预设初始值
    let msgArr = [{ "role": "system", "content": basePreStr }]
    let replyContent = '';
    let usageTokens = 0;

    // 查询数据库中是否存在记录,已存在则替代初始值
    const hisObj = await historyTable.where({ openId }).findOne();
    if (hisObj) {
        msgArr = Object.values(hisObj.historyMsg);
        // 限制用户使用
        if (!superUser.includes(openId) && hisObj.todayTokens >= EverydatMaxFree)
            return `每名用户每天只能使用 ${EverydatMaxFree} tokens\n今天的体力值用完啦,明天再来吧~🎁`
    }

    // 不具备上下文对话的普通模式
    if (hisObj && hisObj.mode === 0) {
        // 单条消息长度不能超过2000
        if (msg.length >= 2000)
            return "消息太长啦~\n笨蛋哆啦理解不了!🏳️"
        msgArr = [{ "role": "user", "content": msg }];
    }
    // 上下文对话模式
    else {
        if (msg.length >= 1500)
            return "消息太长啦~\n笨蛋哆啦理解不了!🏳️";
        // 长度超限处理
        const str = msgArr.map(item => {
            return item.content;
        }).join('\n');
        if (str.length + msg.length >= 1500) {
            const summaryPrompt = '请你概括我们之前的对话内容,要求总字数在150字以内.概括后的内容将作为你的记忆用于进一步的聊天';
            msgArr.push({ "role": "user", "content": summaryPrompt });
            const summaryMsg = await chatGPT(msgArr);
            msgArr = [
                { "role": "system", "content": hisObj.systemRole },
                { "role": "assistant", "content": summaryMsg.reply }
            ]
            if (summaryMsg.status == 'error')
                return summaryMsg.reply;
            usageTokens += parseInt(summaryMsg.usage)
        }
        msgArr.push({ "role": "user", "content": msg });
    }
    const tmpMode = hisObj ? hisObj.mode : 0;
    const res = await chatGPT(msgArr, tmpMode);
    // 调用ChatGPT接口出错时抛出错误
    if (res.status == 'error')
        return res.reply;

    replyContent = res.reply;
    usageTokens += parseInt(res.usage);
    msgArr.push({ "role": "assistant", "content": replyContent });

    try {
        let tmptodayTokens = usageTokens;
        if (hisObj) {
            // 更新消息记录
            if (hisObj.mode === 1)
                hisObj.historyMsg = msgArr;
            // 更新消耗tokens
            hisObj.totalTokens += usageTokens;
            hisObj.todayTokens += usageTokens;
            tmptodayTokens = hisObj.todayTokens;
            await historyTable.save(hisObj);
        } else {
            let { mobile, realName } = await feishuGetUser(openId);
            await historyTable.save({
                openId: openId,
                historyMsg: msgArr,
                systemRole: basePreStr,
                mobile: mobile,
                realName: realName,
                totalTokens: usageTokens,
                todayTokens: usageTokens,
                mode: 0
            });
        }
        return replyContent + `\n\nCost ${usageTokens} tokens\nTotal ${tmptodayTokens} \/ ${EverydatMaxFree}`;
    } catch (err) {
        console.error(`-- [Error in runChat] --\n${err}`);
        return err;
    }
}

// 清除消息记录,但不清除预设人格
const clearHistory = async function (openId) {
    try {
        const hisObj = await historyTable.where({ openId }).findOne();
        hisObj.historyMsg = [{ "role": "system", "content": hisObj.systemRole }];
        const result = await historyTable.save(hisObj);
        // console.log(result)
        return "对话历史已清空✨"
    } catch (err) {
        return `-- [Error in clearHistory] --\nPlease try again\n\n${error}`;
    }
}
// 预设人格同时清除消息记录
const presetRole = async function (msg, openId) {
    try {
        const systemRole = msg.replace('/preset', '').trim();
        const hisObj = await historyTable.where({ openId }).findOne();
        if (!hisObj || (hisObj && hisObj.mode == 0))
            return "请先进入plus模式"
        let result = '';
        if (hisObj) {
            hisObj.historyMsg = [{ "role": "system", "content": systemRole }];
            hisObj.systemRole = systemRole;
            result = await historyTable.save(hisObj);
        } else {
            result = await historyTable.save({
                openId: openId,
                historyMsg: [{ "role": "system", "content": systemRole }],
                systemRole,
            });
        }
        // console.log(result);
        if (msg == basePreStr)
            return "已恢复默认状态🍰"
        return "预设成功🍧";
    } catch (err) {
        return `-- [Error in presetRole] --\nPlease try again\n\n${error}`;
    }
}
// 获取消息记录
const getMsgHis = async function (openId) {
    try {
        const hisObj = await historyTable.where({ openId }).findOne();
        const arr = Object.values(hisObj.historyMsg);
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

const upgradePlus = async (openId) => {
    const hisObj = await historyTable.where({ openId }).findOne();
    // 重置消息记录
    if (hisObj) {
        await presetRole(basePreStr, openId);
        // 设为上下文对话模式
        hisObj.mode = 1;
        await historyTable.save(hisObj)
    }
    else {
        let { mobile, realName } = await feishuGetUser(openId);
        await historyTable.save({
            openId: openId,
            mobile: mobile,
            realName: realName,
            historyMsg: [],
            systemRole: basePreStr,
            totalTokens: 0,
            todayTokens: 0,
            mode: 1
        });
    }
    return "-- 已进入plus模式 -- ";
}

const normalMode = async (openId) => {
    const hisObj = await historyTable.where({ openId }).findOne();
    if (hisObj) {
        // 设为普通模式
        hisObj.mode = 0;
        await historyTable.save(hisObj)
    }
    else {
        let { mobile, realName } = await feishuGetUser(openId);
        await historyTable.save({
            openId: openId,
            mobile: mobile,
            realName: realName,
            historyMsg: [],
            systemRole: basePreStr,
            totalTokens: 0,
            todayTokens: 0,
            mode: 0
        });
    }
    return "-- 已进入普通模式 -- ";
}

const adminGetInfo = async () => {
    const users = await historyTable.where().sort({ todayTokens: -1 }).find();
    let tmpArr = users.map(item => {
        if (item.todayTokens != 0)
            return `${item.realName} : ${item.todayTokens}`;
    }).filter(item => !!item);
    let maxLen = 0;
    tmpArr.forEach(item => {
        if (item.length > maxLen) {
            maxLen = item.length;
        }
    });
    let result = tmpArr.map(item => {
        return item.padEnd(maxLen, " ");
    });
    return '今日使用排行\n' + result.join('\n');
}

const queryStatus = async (openId) => {
    const userObj = await historyTable.where({ openId }).findOne();
    if (userObj) {
        const { realName, todayTokens, mode } = userObj;
        return `用户: ${realName}\n当前模式: ${mode == 0 ? '普通' : '上下文对话'}\n使用情况: ${todayTokens} \/ ${EverydatMaxFree} tokens\n帮助文档: https://uestc.feishu.cn/docx/T3lHdnWRcoU1cpx8MzUckiminRc`
    }
    else return '该用户尚未使用过应用';
}

const sendUpdateMsg = async function () {
    const userArr = await feishuGetAllValidUser();
    // const userArr = [adminOpenId];
    let promises = [];
    for (user of userArr) {
        promises.push(feishuSendMsg({
            receive_id: user,
            content: `{"type": "template", "data": { "template_id": "${welcomeCardId}"} }`,
            msg_type: 'interactive'
        }));
    }
    return await Promise.all(promises)
        .then(res => {
            return '成功推送更新信息';
        }).catch(err => {
            return `-- [Error in sendUpdateMsg] --\n\n${err}`
        });
}
// 飞书 ChatGPT 机器人的入口函数
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

    // 所有调用当前函数的参数都可以直接从 params 中获取
    // 飞书机器人每条用户消息都会有 event_id
    const eventId = params.header.event_id;
    const chatLogTable = aircode.db.table('chatLog');
    // 搜索 contents 表中是否有 eventId 与当前这次一致的
    const tmpLog = await chatLogTable.where({ eventId }).findOne();
    // 如果 tmpLog 有值，则代表这条 event 出现过
    // 由于 ChatGPT 返回时间较长，这种情况可能是飞书系统的重试，直接 return 掉，防止重复调用
    // 当当前环境为 DEBUG 环境时，这条不生效，方便调试
    if (tmpLog && context.trigger !== 'DEBUG') return;

    const message = params.event.message;
    const msgType = message.message_type;

    // 获取发送消息的人信息
    const sender = params.event.sender;
    const openId = sender.sender_id.open_id;
    // 用户发送过来的内容
    let content = '';

    // 返回给用户的消息
    let replyContent = '';
    // 获取鉴权凭证
    const tokensTable = aircode.db.table('cryptdKey');
    const cryptdData = await tokensTable.where().findOne();
    tenantToken = await deCrypto(cryptdData);

    // 目前 ChatGPT 仅支持文本内容
    if (msgType === 'text') {
        // 获取用户消息与预处理
        content = JSON.parse(message.content).text;
        if (content.indexOf('@_all') >= 0) return;
        content = content.replace('@_user_1 ', '');
        // 默认将用户发送的内容回复给用户，仅是一个直接返回对话的机器人
        replyContent = content;
        // 记录聊天日志
        await chatLogTable.save({
            openId: openId,
            UserMsg: content,
            eventId,
            DoraReply: replyContent
        });


        // 如果配置了 OpenAI Key 则让 ChatGPT 回复
        if (OpenAISecret) {
            // 将用户具体消息发送给 ChatGPT,将获取到的 ChatGPT 回复给用户
            replyContent = await runChat(content, sender.sender_id.open_id);
        }
    } else
        replyContent = 'Sorry~ 暂时不支持非文本类型的消息哦😜';

    if (replyContent == 'SILENT') return null;
    await chatLogTable.where({ eventId }).set({ DoraReply: replyContent }).save();
    // 将处理后的消息通过飞书机器人发送给用户
    await feishuReply({
        msgId: message.message_id,
        openId,
        content: replyContent,
    });

    // 整个函数调用结束，需要有返回
    return null;
}
