# 照片灵感墙（带邮箱审核）

这个版本实现了：

- 用户上传图片并填写作品名称、作者、描述、应用场景、联系方式。
- 用户提交后，作品先进入“待审核”，不会立刻出现在前台榜单。
- 系统会尝试把投稿信息和图片发送到管理员邮箱。
- 邮件中包含“审核通过 / 审核不通过”链接。
- 你点击“审核通过”后，作品才会进入首页公开榜单。
- 公开榜单依然支持按点赞数排序、单 IP 每天只能给一张图点赞、每 60 秒自动刷新。

---

## 一、为什么你在 terminal 启动后“没有反应”？

通常是下面几个原因：

1. 你只是运行了命令，但没有打开浏览器访问地址。
2. 你不知道端口号，实际上页面地址是：`http://127.0.0.1:3000`
3. 你的命令行窗口被占住了，这是正常现象，说明 Node 服务正在运行。
4. 如果你关闭了那个 terminal，服务也会一起停止。

正确启动方式：

```bash
npm start
```

启动成功后，你会看到类似提示：

- `照片投稿网站已启动: http://127.0.0.1:3000`
- `如果浏览器没反应，请确认你已经访问上面的地址，而不是只执行了命令。`

然后你再手动打开浏览器，访问：

```text
http://127.0.0.1:3000
```

---

## 二、邮箱审核功能的工作流程

### 用户侧

1. 用户在网页上传图片并填写信息。
2. 用户点击“提交审核”。
3. 后端先把投稿保存到 `data/pending-submissions.json`。
4. 这时候该作品还不会显示在首页。

### 管理员侧

1. 你的邮箱 `1113563895@qq.com` 收到一封审核邮件。
2. 邮件里可以看到：
   - 图片
   - 作品名称
   - 作者
   - 一句话描述
   - 应用场景
   - 联系方式
3. 邮件里有两个链接：
   - 审核通过
   - 审核不通过
4. 点击“审核通过”后，后端会把这条投稿写入 `data/photos.json`。
5. 首页刷新后，就能看到这条图片作品。

---

## 三、你必须配置的环境变量

> **重点：QQ 邮箱发信不能只写邮箱账号，还必须使用 QQ 邮箱“SMTP 授权码”，不是 QQ 登录密码。**

先在 QQ 邮箱后台开启 SMTP 服务，然后准备下面这些变量：

### Linux / macOS

```bash
export SMTP_HOST=smtp.qq.com
export SMTP_PORT=465
export SMTP_SECURE=true
export SMTP_USER=你的QQ邮箱@qq.com
export SMTP_PASS=你的QQ邮箱SMTP授权码
export MAIL_FROM=你的QQ邮箱@qq.com
export MAIL_TO=1113563895@qq.com
export PUBLIC_BASE_URL=http://127.0.0.1:3000
npm start
```

### Windows PowerShell

```powershell
$env:SMTP_HOST="smtp.qq.com"
$env:SMTP_PORT="465"
$env:SMTP_SECURE="true"
$env:SMTP_USER="你的QQ邮箱@qq.com"
$env:SMTP_PASS="你的QQ邮箱SMTP授权码"
$env:MAIL_FROM="你的QQ邮箱@qq.com"
$env:MAIL_TO="1113563895@qq.com"
$env:PUBLIC_BASE_URL="http://127.0.0.1:3000"
npm start
```

---

## 四、每个文件是做什么的

- `server.js`
  - 后端主程序
  - 处理上传、审核、点赞、邮件发送
- `public/index.html`
  - 页面结构
- `public/styles.css`
  - 页面样式
- `public/app.js`
  - 前端交互逻辑
- `data/pending-submissions.json`
  - 待审核投稿
- `data/photos.json`
  - 已审核通过并公开展示的作品
- `data/votes.json`
  - 点赞记录

---

## 五、如果你要自己继续改 Git 仓库，最简单的步骤

下面是最适合新手的方式：

### 第 1 步：查看当前改动

```bash
git status
```

### 第 2 步：把所有改动加入暂存区

```bash
git add .
```

### 第 3 步：提交一次版本

```bash
git commit -m "完善邮箱审核投稿流程"
```

### 第 4 步：推送到你的远程仓库

```bash
git push
```

如果你还没有设置远程仓库，需要先执行：

```bash
git remote -v
```

看看有没有 `origin`。

---

## 六、当前版本的限制

1. 目前使用 JSON 文件充当轻量数据库，适合初版演示。
2. 如果以后要正式上线，建议改成 SQLite / MySQL / PostgreSQL。
3. `PUBLIC_BASE_URL` 必须是管理员邮箱里能真正访问到的地址；如果你只写 `127.0.0.1`，那只有你自己的电脑能点开审核链接。
4. 如果你以后想让别人从外网提交并且你能正常点邮件审核链接，建议把项目部署到公网服务器。
