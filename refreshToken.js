// @see https://docs.aircode.io/guide/functions/
const aircode = require('aircode');
const { fetchAndSaveToken } = require('./server');

module.exports = async function (params, context) {
    let res = await fetchAndSaveToken();
    return {
        message: res ? 'success' : 'false'
    };
};
