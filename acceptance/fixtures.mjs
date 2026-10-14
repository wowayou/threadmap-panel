// Independent acceptance fixture: database IDs deliberately differ from floor numbers.
export const topicId = 7001;
export function post(number, text, reply = null, topic = topicId) {
  return { id: topic * 1000 + number, topic_id: topic, post_number: number,
    username: ({21:'Charm',22:'Asher',23:'laozuo',24:'wowayou'})[number] || `reader${number}`,
    created_at: new Date(Date.UTC(2026, 8, 17, 8, number)).toISOString(),
    cooked: text.split('\n').map(line => `<p>${line}</p>`).join(''), reply_to_post_number: reply };
}
export const seedPosts = [
  post(21, '川流不息\n息息相关\n关关雎鸠\n咎由自取'),
  post(22, '讨论积分乐园'),
  post(23, '取之不尽\n尽力而为\n为所欲为\n为所欲为', 21),
  post(24, '曲高和寡\n刮目相看\n侃侃而谈\n贪得无厌', 21),
];
export const historyPosts = [
  ...Array.from({length:20}, (_,i) => post(i+1, `这是一条用于验证加载流程的普通讨论，楼层编号为 ${i+1}。`)),
  ...seedPosts,
  ...Array.from({length:21}, (_,i) => post(i+25, `这是一条用于验证分批读取的普通讨论，楼层编号为 ${i+25}。`)),
];

export function hostHtml(posts = seedPosts, topic = topicId) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Discourse integration fixture</title>
    <meta name="discourse-base-uri" content="/"><style>
      body{margin:0;background:#f7f8f9;color:#27332f;font:16px system-ui}header{padding:22px;background:white;border-bottom:1px solid #ddd}
      main{max-width:650px;margin:40px auto 450px;padding-right:350px}.topic-post{min-height:320px;background:white;padding:24px;border-bottom:1px solid #ddd}
      .names{font-weight:bold}.cooked p{line-height:1.6}a{color:#167269}
    </style></head><body><header>Discourse 测试宿主 · 仅模拟公开标记</header>
    <main id="topic"><h1 class="fancy-title">接龙与并行讨论</h1>
    ${posts.map(p => `<div class="topic-post" data-post-number="${p.post_number}">
      <article id="post_${p.post_number}" data-post-id="${p.id}" data-topic-id="${topic}">
      <div class="names"><span class="username"><a data-user-card="${p.username}" href="/u/${p.username}">${p.username}</a></span></div>
      <time datetime="${p.created_at}">${p.created_at}</time>
      ${p.reply_to_post_number ? '<a class="reply-to-tab" role="button">Charm</a>' : ''}
      <div class="cooked">${p.cooked}</div></article></div>`).join('')}
    </main></body></html>`;
}
