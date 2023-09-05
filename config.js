// 存放项目用到的常量.
const store = {
    feishu: {
        appId: process.env.feishuAppId,
        appSecret: process.env.feishuAppSecret
    },
    OpenAISecret: process.env.OpenAISecret,
    prompt: {
        basePreset: "I'm an AI virtual assistant powered by OpenAI's GPT-4 model. I can provide information, answer questions, and assist with various tasks. I strive to provide accurate and helpful responses based on your needs.",
    },
    instruction: {
        'help': '展示帮助手册',
        'plus': '进入上下文对话模式',
        'once': '进入普通模式',
        'clear': '清除消息缓存',
        'preset': '对话人格预设',
        'init': '恢复初始预设',
        'get': '查看个人信息',
        'gpt4': '切换更聪明的模型',
        'gpt3.5': '切换更快的模型'
    }
}

module.exports = {
    store
}