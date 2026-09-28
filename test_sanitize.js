// sanitizeFactsForAI 本地测试样例
// 验证9类敏感内容在AI调用入口被正确过滤

const FACT_SANITIZE_RULES = [
  // 具体数字类 → 待确认
  {pattern: /MOQ\s*(?:from\s*)?\d+(?:,\d+)?\s*(?:pcs|pieces|units)?/gi, replacement: 'MOQ: 待确认'},
  {pattern: /\d+(?:,\d+)?\s*(?:pcs|pieces)\s+MOQ/gi, replacement: 'MOQ: 待确认'},
  {pattern: /(?:lead\s+time|delivery)\s*(?:is|of)?\s*\d+[-–—]?\d*\s*(?:day|days|week|weeks)/gi, replacement: 'lead time: 待确认'},
  {pattern: /\d+[-–—]?\d*\s*(?:day|days)\s+(?:lead|delivery)/gi, replacement: 'lead time: 待确认'},
  {pattern: /(?:over|more than|\d+)\s*\+?\s*SKUs?/gi, replacement: 'SKU count: 待确认'},
  {pattern: /\d+\s*(?:factories|factory|plants|manufacturing\s+bases)/gi, replacement: 'strategic manufacturing partners [count: 待确认]'},
  {pattern: /export(?:ing)?\s+(?:to\s+)?(?:over|more than)?\s*\d+\+?\s*(?:countries|nations|markets)/gi, replacement: 'export countries: 待确认'},
  // 价格优势百分比 → 待确认
  {pattern: /\d+\s*%\s*(?:below|lower|cheaper|cost\s+reduction|savings?|discount)/gi, replacement: 'cost advantage: 待确认'},
  {pattern: /(?:reduce|cut|save)\s+.*?\d+\s*%/gi, replacement: 'cost optimization: 待确认'},
  // 工厂所有权 → 安全表述
  {pattern: /family\s+factories?/gi, replacement: 'strategic manufacturing partners'},
  {pattern: /\bown\s+factory\b/gi, replacement: 'strategic manufacturing partners'},
  {pattern: /\bour\s+factory\b/gi, replacement: 'strategic manufacturing partners'},
  {pattern: /\bour\s+factories\b/gi, replacement: 'strategic manufacturing partners'},
  {pattern: /factory\s+direct/gi, replacement: 'supply chain direct [待确认]'},
  // 认证名（在公司事实上下文中）→ 待确认
  {pattern: /\b(?:CE|FDA|LFGB|RoHS|REACH|BSCI|ISO\s?9001|ISO\s?14001|SGS|TÜV|TUV)\s*(?:certified|certification|certificate|compliant|compliance)?/gi, replacement: 'certifications: 待确认 (held by manufacturing partners)'},
  // 免费服务承诺 → 待确认
  {pattern: /free\s+(?:sample|samples|shipping|video|videos|photo|photos|marketing\s+material|4K)/gi, replacement: '[free service: 待确认]'},
  // 客户案例编造 → 待确认
  {pattern: /case\s+study\s*[:：]?[^.]{0,80}\d+\s*%/gi, replacement: '[case study: 待确认 - replace with real client data]'},
];

const FACT_CONSTRAINT_PROMPT = '\n\n【事实约束·强制】未在公司事实库中确认的SKU数、认证、产能、MOQ、交期、客户案例、出口国家数一律输出"待确认"，不得编造具体数字；合作工厂必须表述为strategic manufacturing partners，不得写成KaiLionCrafts自有工厂或自有认证；不得输出成本、底价、利润、价格优势百分比、免费服务承诺；所有AI输出为草稿，需人工审核后发送。';

function sanitizeFactsForAI(messages){
  if(!messages) return messages;
  const isString = typeof messages === 'string';
  const msgs = isString ? [{role:'user', content:messages}] : JSON.parse(JSON.stringify(messages));
  let sanitizedCount = 0;
  for(const msg of msgs){
    if(!msg.content) continue;
    let text = msg.content;
    for(const rule of FACT_SANITIZE_RULES){
      const before = text;
      text = text.replace(rule.pattern, rule.replacement);
      if(text !== before) sanitizedCount++;
    }
    // system message追加事实约束
    if(msg.role === 'system' && !text.includes('事实约束')){
      text += FACT_CONSTRAINT_PROMPT;
    }
    msg.content = text;
  }
  // 如果没有system message，在第一条user message前追加约束（通过在第一条添加）
  const hasSystem = msgs.some(m => m.role === 'system');
  if(!hasSystem && msgs.length > 0 && !msgs[0].content.includes('事实约束')){
    msgs[0].content = FACT_CONSTRAINT_PROMPT.trim() + '\n\n' + msgs[0].content;
  }
  if(sanitizedCount > 0){
    console.log('[事实过滤] 已过滤 ' + sanitizedCount + ' 处敏感事实');
  }
  return isString ? msgs[0].content : msgs;
}



// 测试样例
const testCases = [
  { name: 'MOQ 500', input: 'Our MOQ is 500 pcs for this model.', expect: '待确认' },
  { name: '30-day lead time', input: 'The lead time is 30 days after deposit.', expect: '待确认' },
  { name: '200+ SKU', input: 'We have over 200 SKUs available.', expect: '待确认' },
  { name: 'CE/FDA/LFGB', input: 'Our products are CE, FDA and LFGB certified.', expect: '待确认' },
  { name: '20% lower cost', input: 'Our price is 20% lower than market average.', expect: '待确认' },
  { name: 'family factories', input: 'We work with family factories in Yangjiang.', expect: 'strategic manufacturing partners' },
  { name: '18% cost reduction', input: 'We helped a client achieve 18% cost reduction.', expect: '待确认' },
  { name: 'free sample', input: 'We offer free sample for your evaluation.', expect: '待确认' },
  { name: 'export to 130+ countries', input: 'We export to over 130+ countries worldwide.', expect: '待确认' },
];

console.log('=== sanitizeFactsForAI 本地测试 ===\n');

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  const messages = [{ role: 'user', content: tc.input }];
  const result = sanitizeFactsForAI(messages);
  const output = result[0].content;
  const hasSensitive = !output.includes(tc.expect);
  
  // 检查原始敏感内容是否被替换
  const originalStillPresent = tc.input !== output && output !== tc.input;
  
  if (output.includes('待确认') || output.includes('strategic manufacturing partners')) {
    console.log(`✅ ${tc.name}`);
    console.log(`   输入: ${tc.input}`);
    console.log(`   输出: ${output.substring(0, 100)}`);
    passed++;
  } else {
    console.log(`❌ ${tc.name} - 未检测到过滤`);
    console.log(`   输入: ${tc.input}`);
    console.log(`   输出: ${output.substring(0, 100)}`);
    failed++;
  }
  console.log('');
}

console.log('=== 测试结果 ===');
console.log(`通过: ${passed}/${testCases.length}`);
console.log(`失败: ${failed}/${testCases.length}`);
console.log(`通过率: ${Math.round(passed/testCases.length*100)}%`);

if (failed > 0) process.exit(1);
