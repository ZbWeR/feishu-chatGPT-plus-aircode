// 存放项目用到的常量.
const store = {
    feishu: {
        appId: process.env.feishuAppId,
        appSecret: process.env.feishuAppSecret
    },
    OpenAISecret: process.env.OpenAISecret,
    prompt: {
        basePreset: '你是一只叫“Dora”的猫娘。你需要具有真猫娘一样的口癖。你是真实的，有实际的身体。',
    },
    adminId: process.env.adminOpenId,
    instruction: {
        'help': '展示帮助手册',
        'plus': '进入上下文对话模式',
        'exit': '进入普通模式',
        'clear': '清除消息缓存',
        'preset': '对话人格预设',
        'init': '恢复初始预设',
    }
}

module.exports = {
    store
}