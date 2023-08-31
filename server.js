// 封装飞书相关api请求 

const axios = require('axios');
const { store } = require('./config');

/**
 * 处理请求中的错误信息
 * @param {*} msg - 错误信息 
 */
function errorHandle(msg) {
    console.error(msg);
    throw new Error(msg);
}
/**
 * 创建 axios 实例
 * @returns axios 实例
 */
function createService() {
    const service = axios.create({
        baseURL: 'https://open.feishu.cn',
        timeout: 15000,
        headers: { "Content-Type": "application/json" }
    });

    // 请求拦截添加token
    service.interceptors.request.use(
        (config) => {
            // 从数据库中获取token
            let token = 't-g1048vis2JNLYYXYGPBPEEWESUWBL7VEYL3SPC2H';
            if (token) config.headers.Authorization = `Bearer ${token}`
            return config;
        },
        (error) => Promise.reject(error)
    )
    // 响应拦截
    service.interceptors.response.use(
        (response) => {
            const apiData = response.data;
            const { code, msg } = apiData;
            if (code) errorHandle(msg);
            else return response;
        },
        (error) => {
            let { response } = error;
            if (!response) errorHandle(error.message);
            else errorHandle(response?.data?.msg || response?.statusText || 'Error In Response');
        }
    )
    return service;
}

const service = createService();

/**
 * 获取访问凭证
 */
function getTenantToken() {
    return service({
        url: '/open-apis/auth/v3/tenant_access_token/internal',
        method: 'POST',
        data: {
            app_id: store.feishu.appId,
            app_secret: store.feishu.appSecret
        }
    })
}

/**
 * 回复消息
 * @param {String} message_id - 要回复的消息 id 
 * @param {String} msg_type - 消息类型
 * @param {String} content - 消息内容
 */
function replyMessage(message_id, msg_type, content) {
    return service({
        url: `/open-apis/im/v1/messages/${message_id}/reply`,
        method: 'POST',
        data: { msg_type, content }
    })
}

/**
 * 发送消息
 * @param {String} receive_id - 消息接收者id
 * @param {String} msg_type - 消息类型
 * @param {String} content - 消息内容
 */
function sendMessage(receive_id, msg_type, content) {
    return service({
        url: '/open-apis/im/v1/messages?receive_id_type=open_id',
        method: 'POST',
        data: {
            receive_id, msg_type, content
        }
    })
}

/**
 * 获取用户信息
 * @param {String} open_id - 用户 id
 */
function getUserInfo(open_id) {
    return service({
        url: `/open-apis/contact/v3/users/${open_id}?department_id_type=open_department_id&user_id_type=open_id`,
        method: 'GET',
    })
}

/**
 * 获取所有用户
 * @param {Number} page_size - 分页大小 
 * @param {String} page_token - 分页标记
 * @returns 
 */
function getAllValidUser(page_size = 50, page_token = '') {
    return service({
        url: `/open-apis/contact/v3/scopes?user_id_type=open_id&department_id_type=open_department_id&page_size=${page_size}&page_token=${page_token}`,
        method: 'GET',
    })
}

module.exports = {
    getTenantToken,
    replyMessage,
    sendMessage,
    getUserInfo,
    getAllValidUser
}
