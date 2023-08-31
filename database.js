// @see https://docs.aircode.io/guide/functions/
const aircode = require('aircode');
const { getTenantToken } = require('./server');

const runtimeLog = aircode.db.table('runtimeLog');
const token = aircode.db.table('token');
const userConfig = aircode.db.table('userConfig');

/**
 * 获取 token 并保存到数据库
 */
async function fetchAndSaveToken() {
    try {
        let { data } = await getTenantToken();
        let { tenant_access_token } = data;
        await token
            .where()
            .set({ accessToken: tenant_access_token })
            .upsert(true)
            .save();
        return tenant_access_token;
    } catch {
        return null;
    }
}

/**
 * 获取数据库中的token
 * @returns accessToken - 访问凭证
 */
async function getToken() {
    try {
        let { accessToken } = await token.where().findOne() || {};
        // 没找到就重新获取
        if (!accessToken)
            accessToken = await fetchAndSaveToken();
        return accessToken;
    } catch (err) {
        return null;
    }
}

module.exports = {
    fetchAndSaveToken,
    getToken,
    runtimeLog,
    userConfig
}