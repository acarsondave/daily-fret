// The shape of the day's screen, driven in a real browser.
//
// This suite exists because the layout it checks was rebuilt to fix a fault no
// unit test could have seen: on a 1366x572 laptop the list had 121px of height
// to show 504px of tasks — six tasks, one of them whole — while 566px of the
// width, 41% of the screen, held nothing at all. Every check below is either
// that fault or one of the ones found while fixing it.
//
//   npm run build && npx vite preview --port 4173 --strictPort
//   node tests/browser/layout.mjs

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE=process.env.PREVIEW_URL ?? 'http://localhost:4173/';
const SHOT=(process.argv[2] ?? 'tests/browser/.shots') + '/layout-';
mkdirSync(SHOT.slice(0, SHOT.lastIndexOf('/')), { recursive: true });
const pair=(a,b)=>`pair:${[a,b].sort().join('|')}`;
const iso=(d)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const daysAgo=(n)=>{const d=new Date();d.setDate(d.getDate()-n);return iso(d);};
let fails=0;
const check=(l,ok,d)=>{if(!ok)fails++;console.log(`  ${ok?'ok  ':'FAIL'}  ${l}${d?` — ${d}`:''}`);};

const tasks=[['t1','Chord Perfect','10 mins'],['t2','Spider Exercises','3 mins'],['t3','Anchor changes','5 mins'],
             ['t4','One Minute Changes','5 mins'],['t5','Strum timing','6 mins'],['t6','Song: Horse With No Name','8 mins']];
const account=(extra={})=>({
  activeRoutineId:'r1',currentLesson:'b1-403',
  routines:[{id:'r1',name:'Module 4 Daily',description:'',isDefault:true,
    tasks:tasks.map(([id,title,duration])=>({id,title,duration,
      ...(id==='t1'?{drill:{kind:'chord-trainer',durationSec:90,chords:['Am','Em']}}:{})}))}],
  dailyLogs:Object.fromEntries(Array.from({length:20},(_,i)=>{const date=daysAgo(i+1);
    return [date,{date,routineId:'r1',completedTaskIds:['t1'],drillResults:{[pair('Am','Dm')]:85+i,t1:15}}];})),
  strumPatterns:[],songLinks:[],updatedAt:1,...extra});
const seed=(e)=>({currentAccountId:'anonymous',accounts:{anonymous:account(e)}});

const browser=await chromium.launch();
async function open(state,vp){
  const ctx=await browser.newContext({viewport:vp});
  const page=await ctx.newPage();
  const errors=[];
  page.on('console',m=>m.type()==='error'&&errors.push(m.text()));
  page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(s=>localStorage.setItem('daily-fret-storage',JSON.stringify({state:s,version:0})),state);
  await page.goto(BASE,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('.task-container');
  await page.waitForTimeout(650);
  return {ctx,page,errors};
}
const box=(page,sel)=>page.evaluate(s=>{const e=document.querySelector(s);if(!e)return null;
  const b=e.getBoundingClientRect();return {x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1),
  right:+b.right.toFixed(1),bottom:+b.bottom.toFixed(1)};},sel);

for (const vp of [{width:1440,height:900},{width:1366,height:572},{width:1280,height:800},
                  {width:1024,height:700},{width:900,height:700},{width:768,height:900},
                  {width:430,height:860},{width:390,height:780},{width:360,height:740}]) {
  console.log(`\n=== ${vp.width}x${vp.height} ===`);
  const {ctx,page,errors}=await open(seed(),vp);

  // no sideways scroll, ever
  const sideways=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  check('no sideways scroll',sideways<=0,`overflow ${sideways}px`);

  // the page itself never scrolls; the list does
  const pageScroll=await page.evaluate(()=>document.documentElement.scrollHeight-document.documentElement.clientHeight);
  check('page does not scroll',pageScroll<=0,`${pageScroll}px`);

  // how much of the list is actually visible
  const vis=await page.evaluate(()=>{
    const l=document.querySelector('.task-list-scrollable').getBoundingClientRect();
    return [...document.querySelectorAll('.task-row')]
      .filter(e=>{const b=e.getBoundingClientRect();return b.top>=l.top-1&&b.bottom<=l.bottom+1;}).length;
  });
  const list=await box(page,'.task-list-scrollable');
  console.log(`        list ${list.h}px, ${vis}/6 rows whole`);
  check('more than one task is readable',vis>=2,`${vis} visible`);

  // nothing overlaps the wordmark
  // The mark, not the bar it sits in. The bar spans the full container so its
  // left edge can line up with the columns, and it is click-through; only the
  // ~130px of ink at its start can actually cover anything.
  const foot=await box(page,'.footer-content');
  if (foot && foot.w>0) {
    const clash=await page.evaluate(()=>{
      const f=document.querySelector('.footer-content').getBoundingClientRect();
      const hit=[...document.querySelectorAll('.task-row,.progress-launch,.routine-selector,.ledger-figure,.add-task-btn')]
        .filter(e=>{const b=e.getBoundingClientRect();
          return b.right>f.left&&b.left<f.right&&b.bottom>f.top&&b.top<f.bottom;});
      return hit.map(e=>e.className.toString().slice(0,40));
    });
    check('wordmark sits over nothing',clash.length===0,clash.join(', '));

    // And the bar around it never intercepts a press meant for the rail.
    const throughBar=await page.evaluate(()=>{
      const bar=document.querySelector('.app-footer').getBoundingClientRect();
      const x=Math.round(bar.right-40), y=Math.round(bar.top+bar.height/2);
      const el=document.elementFromPoint(x,y);
      return !el || !el.closest('.app-footer');
    });
    check('the footer bar catches nothing',throughBar);
  }

  // everything on screen
  const off=await page.evaluate(()=>{
    const W=innerWidth,H=innerHeight;
    return [...document.querySelectorAll('.progress-launch,.routine-selector,.ledger-figure,.streak-graph,.add-task-btn,.account-btn')]
      .filter(e=>{const b=e.getBoundingClientRect();
        return b.width>0&&(b.left<-1||b.right>W+1||b.top<-1||b.bottom>H+1);})
      .map(e=>`${e.className.toString().split(' ')[0]}@${Math.round(e.getBoundingClientRect().bottom)}`);
  });
  check('nothing is off screen',off.length===0,off.join(', '));

  // the rail shares one left margin
  if (vp.width>=900) {
    const xs=await page.evaluate(()=>{
      const q=[...document.querySelectorAll('.path-rail-nav .routine-selector, .path-rail-nav .progress-launch')];
      return q.map(e=>{
        const icon=e.querySelector('svg');
        return icon?+icon.getBoundingClientRect().x.toFixed(1):null;
      }).filter(v=>v!==null);
    });
    check('rail items share one margin',new Set(xs).size===1,`x: ${[...new Set(xs)].join(', ')}`);
  }

  check('no console errors',errors.length===0,errors.join(' | '));
  await page.screenshot({path:`${SHOT}f-${vp.width}x${vp.height}.png`});
  await ctx.close();
}

// day zero: no measurements, and the empty rail
console.log('\n=== day zero, 1366x572 ===');
{
  const {ctx,page,errors}=await open(seed({dailyLogs:{}}),{width:1366,height:572});
  check('the ledger holds its places open',(await page.locator('.ledger-value.is-blank').count())===3);
  check('one thing to press',(await page.locator('.ledger-start').count())===1);
  check('no console errors',errors.length===0,errors.join(' | '));
  await page.screenshot({path:`${SHOT}f-dayzero.png`});
  await ctx.close();
}

// the routine menu still opens over the list
console.log('\n=== the routine menu, 1366x572 ===');
{
  const {ctx,page,errors}=await open(seed(),{width:1366,height:572});
  await page.locator('.routine-selector').click();
  await page.waitForTimeout(300);
  const d=await box(page,'.routine-dropdown');
  check('the menu opens',d!==null&&d.h>0);
  const covered=await page.evaluate(()=>{
    const d=document.querySelector('.routine-dropdown').getBoundingClientRect();
    const el=document.elementFromPoint(d.x+d.width/2,d.y+d.height/2);
    return el?.closest('.routine-dropdown')!==null;
  });
  check('the menu is on top',covered);
  check('the menu is on screen',d.right<=1366&&d.bottom<=572,JSON.stringify(d));
  check('no console errors',errors.length===0,errors.join(' | '));
  await page.screenshot({path:`${SHOT}f-menu.png`});
  await ctx.close();
}

// --- reading order vs source order ----------------------------------------
// Where each region is drawn, per breakpoint, reading the way a person reads.
const EXPECT={
  1366:['nav','tasks','record'],   // three columns, left to right
  1024:['nav','record','tasks'],   // rail, then the band, then the list under it
  390 :['nav','record','tasks'],   // one column, top to bottom
};

for (const w of [1366,1024,390]) {
  for (const [state,who] of [[seed(),'a practised account'],[seed({dailyLogs:{}}),'day zero']]) {
    const ctx=await browser.newContext({viewport:{width:w,height:w===390?780:700}});
    const page=await ctx.newPage();
    await page.addInitScript(s=>localStorage.setItem('daily-fret-storage',JSON.stringify({state:s,version:0})),state);
    await page.goto(BASE,{waitUntil:'domcontentloaded'});
    await page.waitForSelector('.task-container');
    await page.waitForTimeout(500);

    // Walk one full cycle: stop when focus returns to the first thing it hit.
    const seen=[]; let first=null;
    for (let i=0;i<40;i++){
      await page.keyboard.press('Tab');
      const at=await page.evaluate(()=>{const e=document.activeElement;
        if(!e||e===document.body)return null;const b=e.getBoundingClientRect();
        const region=e.closest('.path-rail-nav')?'nav':e.closest('.path-rail-record')?'record':
                     e.closest('.task-container')?'tasks':'header';
        // Where this element sits in the source, among everything focusable in
        // its own region. Stable under scrolling, which viewport y is not.
        const root=e.closest('.path-rail-nav, .path-rail-record, .task-container');
        const order=root
          ? [...root.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].indexOf(e)
          : -1;
        return {region, order, y:Math.round(b.y), x:Math.round(b.x),
                key:(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,30)+'#'+order};});
      if(!at) continue;
      if(first===null) first=at.key; else if(at.key===first) break;
      seen.push(at);
    }
    const inner=seen.filter(s=>s.region!=='header');
    const visited=inner.map(s=>s.region).filter((r,i,a)=>r!==a[i-1]);

    console.log(`\n[${w}px / ${who}] ${visited.join(' -> ')}`);

    // A region is entered once and left once. Interleaving means the source and
    // the screen disagree about what belongs together.
    check('each region is one run of focus', new Set(visited).size===visited.length, visited.join(' -> '));

    // And they are entered in the order they are read.
    const want=EXPECT[w].filter(r=>visited.includes(r));
    // At 1200 and up the record rail is drawn to the right of the list but
    // comes before it in the source, and that is the deliberate half of a trade
    // rather than an oversight: below 1200 the same block is drawn *above* the
    // list, and a block that reads above a list but tabs after every one of its
    // rows is two different orders for one screen. The narrow layouts win,
    // because that is where this sits in the reading path instead of beside it.
    // It costs one jump, on day zero only, where the rail holds the only
    // focusable thing it ever holds.
    const traded = w >= 1200 && visited.join() === ['nav','record','tasks'].filter(r=>visited.includes(r)).join();
    check('regions are entered in reading order', visited.join()===want.join() || traded,
      `got ${visited.join(' -> ')}, want ${want.join(' -> ')}`);
    if (traded) console.log('        (the wide layout\'s known trade: the record rail is sourced before the list)');

    // Within a region, focus only ever moves forward.
    //
    // Measured in source order rather than in viewport y, which was the first
    // version of this check and was wrong: the list scrolls focus into view, so
    // a row further down the column can land higher up the window than the one
    // before it and the check called a working list broken.
    for (const region of new Set(visited)) {
      const idx=inner.filter(s=>s.region===region).map(s=>s.order);
      check(`${region}: focus runs down the column`, idx.every((n,i)=>i===0||n>idx[i-1]), idx.join(', '));
    }
    await ctx.close();
  }
}


// --- one margin down the left edge -----------------------------------------
//
// The header, the columns and the wordmark each used to choose their own
// horizontal inset and agreed at exactly one window width. Nobody points at a
// 20px disagreement; everybody feels it.
console.log('\nEdges');
for (const w of [1800,1440,1366,1280,1024,900,820,768,430,390,360]) {
  const ctx=await browser.newContext({viewport:{width:w,height:900}});
  const page=await ctx.newPage();
  await page.addInitScript(s=>localStorage.setItem('daily-fret-storage',JSON.stringify({state:s,version:0})),seed());
  await page.goto(BASE,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('.task-container');
  await page.waitForTimeout(450);
  const e=await page.evaluate(()=>{
    // Hidden things have no edge to line up. `display:none` reports a zero box,
    // and reading that as "flush left" is how a check invents a defect.
    const vis=(el)=>el&&el.getClientRects().length>0;
    const L=(s)=>{const el=document.querySelector(s);return vis(el)?Math.round(el.getBoundingClientRect().left):null;};
    const R=(s)=>{const el=document.querySelector(s);return vis(el)?Math.round(el.getBoundingClientRect().right):null;};
    const gi=(s)=>{const el=document.querySelector(s);if(!vis(el))return null;
      const svg=el.querySelector('svg')||el;return Math.round(svg.getBoundingClientRect().left);};
    return {rowL:L('.task-row'),rowR:R('.task-row'),bandL:L('.path-rail-record'),bandR:R('.path-rail-record'),
            addIcon:gi('.add-task-btn'),railIcon:gi('.path-rail-nav .rail-group .progress-launch'),
            selIcon:gi('.path-rail-nav .routine-selector'),date:L('.header-date'),
            mark:L('.footer-mark'),col:L('.path-rail-nav')??L('.task-container-wrapper'),
            acct:R('.account-btn'),recR:R('.path-rail-record')};
  });
  const wide=w>=1200, m=[];
  if(!wide && e.bandL!==e.rowL) m.push(`band starts ${e.bandL}, rows ${e.rowL}`);
  if(!wide && e.bandR!==e.rowR) m.push(`band ends ${e.bandR}, rows ${e.rowR}`);
  if(e.addIcon!==null && e.addIcon!==e.rowL) m.push(`add glyph ${e.addIcon}, rows ${e.rowL}`);
  // Only where the nav is a rail. Below 900 it is a centred row of pills and
  // the two are supposed to sit at different x.
  if(w>=900 && e.railIcon!==null && e.railIcon!==e.selIcon) m.push(`rail icons ${e.selIcon} and ${e.railIcon}`);
  if(e.date!==e.col) m.push(`date ${e.date}, column ${e.col}`);
  if(e.mark!==null && e.mark!==e.col) m.push(`wordmark ${e.mark}, column ${e.col}`);
  if(wide && e.acct!==e.recR) m.push(`account ends ${e.acct}, rail ends ${e.recR}`);
  check(`${w}px: one margin down the left edge`, m.length===0, m.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(fails?`\n${fails} FAILED`:'\nALL PASS');
process.exit(fails?1:0);
