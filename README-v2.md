## 🚀开发过程记录

**版权声明**

本项目是基于 [Feishu-ChatGPT(aircode.cool)](https://aircode.cool/q4y1msdim4) 的二次开发,笔者尊重原作者的劳动成果,在此感谢原作者的贡献.

在进行二次开发时,笔者致力于保留原始仓库的核心功能，并添加新的特性以提供更优质的服务.

**新增特性**

GPT相关:
- 🤖现在,聊天机器人支持上下文对话的功能了!
- 💬用户可以使用`/preset`指令为机器人设置不同的人格.

飞书相关:
- 💻优化飞书应用凭证获取的方式提高资源利用率.
- 🌈机器人现在能够发送更加丰富多彩的消息.
- 🎨新增 获取可用范围内用户信息 的功能接口.

**🚨 注意**

1. 在使用本文档提供的代码前,请确保已经按照原仓库的说明进行配置和使用.
2. 环境变量`SECRET_KEY`需要进行额外得配置(用于加密与解密):

    ```javascript
    //生成密钥：使用crypto模块中的randomBytes函数生成一个随机的密钥。
    const crypto = require('crypto');
    const key = crypto.randomBytes(32); // 生成一个32字节的密钥
    console.log(key.toString('hex'));
    ```

将控制台打印出来的key设置为环境变量`SECRET_KEY`的值.

### 🌲 代码结构

| 文件名           | 功能描述                                    |
| :--------------- | :------------------------------------------ |
| `chat.js`           | 与 **GPT** 对话并使用飞书提供的接口处理信息 |
| `clearTokens.js`    | 每日更新用户使用限制                        |
| `getTenantToken.js` | 定时获取飞书应用凭证                        |
| `tokenToSecret.js`  | 对获取的应用凭证进行加密和解密操作          |

### chat 中的飞书API

飞书绝大多数的 API 响应体结构包括下列三个部分:

+ `code` :错误码。如果是成功响应，`code` 取值为 0。
+ `msg`  :错误信息。如果是成功响应，`msg` 取值为 `"success"`。
+ `data` : API 的调用结果。`data` 在一些操作类 API 的返回中可能不存在。

#### [feishuSendMsg]

函数作用: 根据传入的参数 `objs` 发送不同的消息.

官方文档: [发送消息内容 - 飞书开放平台 (feishu.cn)](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/im-v1/message/create_json)

传入参数: 

```json
{
    receive_id: openId,		// 接收者的openId
    msg_type: 'interactive',// 消息类型,此处为消息卡片
    // content具体格式与 msg_type 有关,详情请翻阅
    content: `{"type": "template", "data": { "template_id": "${helpCardId}"} }`
}
```

#### [feishuGetUser]

函数作用: 根据传入的 `openId` 获取用户的个人信息.

官方文档:[获取单个用户信息 - 飞书开放平台 (feishu.cn)](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/contact-v3/user/get)

传入参数: `openId` 发送消息者的用户标识.

返回值说明: 

| 名称     | 类型   | 描述           |
| -------- | ------ | -------------- |
| mobile   | string | 用户的手机号码 |
| realName | string | 用户的真实姓名 |

注意: 该函数涉及用户敏感隐私信息,请合法合规使用.

#### [feishuGetAllValidUser]

函数作用: 获取可用范围内的所有用户标识 `openId`.搭配发送信息的接口可以实现群发公告的功能.

官方文档: [获取通讯录授权范围 - 飞书开放平台 (feishu.cn)](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/contact-v3/scope/list)

### chat 中的聊天功能

#### [runChat]

函数作用: 初步处理用户输入的信息,调用 GPT 的接口返回回复.

官方文档:

+ [Chat completion - OpenAI API](https://platform.openai.com/docs/guides/chat/introduction)
+ [数据库概览 | AirCode 文档](https://docs-cn.aircode.io/guide/database/)

具体说明: 首先判断用户输入的信息是否是 `/` 开头的指令,如果是指令则调用对应的函数. 如果是普通的消息,则向数据库中获取该用户的历史消息,将历史消息与当前消息一并发给 GPT 的接口进行处理.在此过程中如果信息大小超过一定限制会先让 GPT 进行概括再做处理.随后在数据库中更新该用户的历史消息.最终返回 GPT 的回复.

**实现上下文对话的关键**: 利用好 `role: user/assistant`,user代表用户之前的问题,assistant代表 GPT 之前的回复,在发送消息时附带上之前的消息记录,即可实现上下文对话.

**消息历史结构示例**:

```json
[
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Who won the world series in 2020?"},
    {"role": "assistant", "content": "The Los Angeles Dodgers won the World Series in 2020."},
    {"role": "user", "content": "Where was it played?"}
]
```

#### 其他函数

**presetRole**: 为 GPT 设置不同的人格,其本质在于对 `role:system` 的应用,该部分的消息有助于调整 GPT 的回复倾向.

**clearHistory**:清除消息历史记录但不影响人格预设,即在数据库中只清除消息记录,不清除`role:system`对应的信息.

**getMsgHis**: 返回当前用户的消息记录.

#### 数据库结构

| 名称        | 类型   | 描述                                             |
| ----------- | ------ | ------------------------------------------------ |
| openId      | string | 用户身份标识                                     |
| historyMsg  | object | 消息历史记录,实际为json数组,结构已在上文给出示例 |
| systemRole  | string | 用于人格预设的信息                               |
| totalTokens | number | 用户总共花费的tokens                             |
| todayTokens | number | 用户当天花费的tokens,用于限制使用                |

### 🔑 token 的加密解密

加密 / 解密的函数在 `tokenToSecret.js` 中.

加密解密 发生在数据库存取 token 的过程中

#### [enCrypt]

函数作用: 对传入的 token 加密

加密原理: 利用随机向量`iv`和环境变量`SECRET_KEY`使用AES-256-CBC加密算法对传入的参数进行加密,并将密文和随机向量转换成hex字符串返回.

#### [deCrypt]

函数作用: 对传入的 data 进行解密

加密原理: 利用传入数据中携带的随机向量`iv`和环境变量`SECRET_KEY`使用解密算法,并将解密后的结果转换为字符串返回.

#### [getTenantToken]

函数作用: 获取飞书的应用凭证,该凭证将用于后续所有飞书相关API的调用.

官方文档: 

+ [访问凭证说明 - 飞书开放平台 (feishu.cn)](https://open.feishu.cn/document/ukTMukTMukTM/uMTNz4yM1MjLzUzM#a8683ac2)

+ [商店应用获取 tenant_access_token](https://open.feishu.cn/document/ukTMukTMukTM/ukDNz4SO0MjL5QzM/auth-v3/auth/tenant_access_token)

