const crypto = require('crypto');
const aircode = require('aircode');

const SECRET_KEY = process.env.SECRET_KEY;

// 加密
const enCrypt = async (tokens) => {
    key = Buffer.from(SECRET_KEY, 'hex');
    const iv = crypto.randomBytes(16); // 生成一个16字节的随机向量
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);

    let encrypted = cipher.update(tokens);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const data = {
        iv: iv.toString('hex'),
        encryptedData: encrypted.toString('hex')
    };
    return data;
}
// 解密
const deCrypto = async (data) => {
    key = Buffer.from(SECRET_KEY, 'hex');
    const encryptedData = Buffer.from(data.encryptedData, 'hex');
    const iv = Buffer.from(data.iv, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);

    let decrypted = decipher.update(encryptedData);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    const result = decrypted.toString();
    return result;
}

// 获取token
const getTenantToken = async () => {
    const url = 'https://open.feishu.cn/open-apis/v3/auth/tenant_access_token/internal/';
    const res = await axios.post(url, {
        'app_id': feishuAppId,
        'app_secret': feishuAppSecret,
    });
    const errCode = res.data.code;
    if (errCode != 0) {
        console.log('--getTenantToken Error--');
        console.log(res.data);
        return 'error';
    }
    return res.data.tenant_access_token;
};

module.exports = {
    enCrypt,
    deCrypto,
    SECRET_KEY,
}
