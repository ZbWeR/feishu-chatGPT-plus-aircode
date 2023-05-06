// @see https://docs.aircode.io/guide/functions/
const aircode = require('aircode');
const axios = require('axios');
const { enCrypt, SECRET_KEY } = require('./tokenToSecret.js');

const feishuAppId = process.env.feishuAppId;
const feishuAppSecret = process.env.feishuAppSecret;

const getTenantToken = async () => {
    const url = 'https://open.feishu.cn/open-apis/v3/auth/tenant_access_token/internal/';
    const res = await axios.post(url, {
        'app_id': feishuAppId,
        'app_secret': feishuAppSecret,
    });
    const { code, msg } = res.data;
    if (code != 0) {
        console.error(`--getTenantToken Error--\n${msg}`);
        return { code, msg }
    }
    return {
        code: 0,
        msg: res.data.tenant_access_token
    }
};

module.exports = async function (params, context) {
    try {
        const tokensTable = aircode.db.table('cryptdKey');
        // 获取新的token
        const { code, msg } = await getTenantToken();
        if (code != 0) throw new Error(msg);
        // 加密token后存入数据库
        const { iv, encryptedData } = await enCrypt(msg);
        await tokensTable.save({ iv, encryptedData });
        return {
            message: 'update tenantToken Success',
            code: 0,
        };
    } catch (error) {
        console.error(`更新应用凭证时报错: ${error.message}`);
        return {
            code: 1,
            message: `更新应用凭证时报错: ${error.message}`
        }
    }
}
