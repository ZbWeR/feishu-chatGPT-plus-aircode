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
    chatGPT = async (content) => {
        try {
            const res = await client.createChatCompletion({
                model: 'gpt-3.5-turbo',
                messages: content,
                temperature: 0.9,
                max_tokens: 2500
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
const helpCardId = 'ctp_AAr5w43Vmgps';
const adminOpenId = process.env.adminOpenId;

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
    else if (msg.startsWith('/get'))
        return await getMsgHis(openId);
    // 管理员功能: 向所有用户推送更新通知
    else if (openId == adminOpenId && msg.startsWith('/sendUpdateMsg'))
        return await sendUpdateMsg();
    else if (openId == adminOpenId && msg == '/help') {
        await feishuSendMsg({
            receive_id: adminOpenId,
            content: `{"type": "template", "data": { "template_id": "${helpCardId}"} }`,
            msg_type: 'interactive'
        });
        return 'SILENT';
    }


    // 预设初始值
    let msgArr = [{ "role": "system", "content": basePreStr }]
    let replyContent = '';
    let usageTokens = 0;

    // 查询数据库中是否存在记录,已存在则替代初始值
    const hisObj = await historyTable.where({ openId }).findOne();
    if (hisObj) {
        msgArr = Object.values(hisObj.historyMsg);
        // 限制用户使用
        if (openId != adminOpenId && hisObj.todayTokens >= 10000)
            return "每名用户每天只能使用 10000 tokens\n今天的体力值用完啦,明天再来吧~🎁"
    }

    // 单条消息长度不能超过1000
    if (msg.length >= 1000)
        return "消息太长啦~\n笨蛋哆啦理解不了!🏳️"
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
    const res = await chatGPT(msgArr);

    // 调用ChatGPT接口出错时抛出错误
    if (res.status == 'error')
        return res.reply;

    replyContent = res.reply;
    usageTokens += parseInt(res.usage);
    msgArr.push({ "role": "assistant", "content": replyContent });

    try {
        if (hisObj) {
            // 更新消息记录
            hisObj.historyMsg = msgArr;
            // 更新消耗tokens
            hisObj.totalTokens += usageTokens;
            hisObj.todayTokens += usageTokens;
            await historyTable.save(hisObj);
        } else {
            const userInfo = await feishuGetUser(openId);
            await historyTable.save({
                openId: openId,
                historyMsg: msgArr,
                systemRole: basePreStr,
                mobile: userInfo.mobile,
                realName: userInfo.realName,
                totalTokens: usageTokens,
                todayTokens: usageTokens
            });
        }
        return replyContent;
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
    const contentsTable = aircode.db.table('contents');
    // 搜索 contents 表中是否有 eventId 与当前这次一致的
    const contentObj = await contentsTable.where({ eventId }).findOne();
    // 如果 contentObj 有值，则代表这条 event 出现过
    // 由于 ChatGPT 返回时间较长，这种情况可能是飞书系统的重试，直接 return 掉，防止重复调用
    // 当当前环境为 DEBUG 环境时，这条不生效，方便调试
    if (contentObj && context.trigger !== 'DEBUG') return;
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

        // 将消息体信息储存到数据库中，以备后续查询历史或做上下文支持使用
        await contentsTable.save({
            eventId: params.header.event_id,
            msgId: message.message_id,
            openId,
            content,
        });

        // 如果配置了 OpenAI Key 则让 ChatGPT 回复
        if (OpenAISecret) {
            // 将用户具体消息发送给 ChatGPT,将获取到的 ChatGPT 回复给用户
            replyContent = await runChat(content, sender.sender_id.open_id);
        }
    } else
        replyContent = 'Sorry~ 暂时不支持非文本类型的消息哦😜';

    if (replyContent == 'SILENT') return null;
    // 将处理后的消息通过飞书机器人发送给用户
    await feishuReply({
        msgId: message.message_id,
        openId,
        content: replyContent,
    });

    // 整个函数调用结束，需要有返回
    return null;
}
