// 引入基础依赖包
const aircode = require('aircode');
const historyTable = aircode.db.table('history');

module.exports = async function (params, context) {
    const allRecords = await historyTable.where().find();
    for (let item of allRecords)
        item.todayTokens = 0;
    await historyTable.save(allRecords);
    console.log('-- 每日更新tokens --');
    return {
        message: 'Update Success',
    };
}
