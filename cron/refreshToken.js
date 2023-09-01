const { fetchAndSaveToken } = require('../database');

module.exports = async function (params, context) {
    try {
        let res = await fetchAndSaveToken();
        if (res) return { msg: 'success' };
        else return { msg: 'failed' };
    } catch (error) {
        console.error(`更新凭证时报错: ${error.message}`);
        return { msg: 'failed' };
    }
};
