window.__ModuleLoader__.load({
  id: 'dsh-memsys',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'dsh-memsys';
    const API = '/dsh-memsys/api/summary';
    const CONFIG = '/dsh-memsys/api/config';
    const SEARCH = '/dsh-memsys/api/search';
    const DETAIL = '/dsh-memsys/api/memory';

    // A ball is only guaranteed to be inside `recent` right after a refresh; a
    // stale shelf or a future paged shelf can hold ids the payload no longer has.
    // Then the card has to be fetched by id instead of silently doing nothing.
    async function fetchMemory(id) {
      const response = await fetch(DETAIL + '?id=' + encodeURIComponent(id));
      if (!response.ok) throw new Error(String(response.status));
      return response.json();
    }

    function resolveMemory(id, recent, fetcher) {
      const local = (recent ?? []).find((memory) => memory.id === id);
      if (local) return Promise.resolve(local);
      return fetcher(id);
    }
    const PERSONA = '/dsh-memsys/api/persona';

    function useSummary() {
      const [state, setState] = React.useState(null);
      React.useEffect(() => {
        let alive = true;
        const load = () => {
          fetch(API)
            .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
            .then((data) => alive && setState(data))
            .catch(() => alive && setState({ error: true }));
        };
        load();
        const timer = setInterval(load, 15000);
        return () => {
          alive = false;
          clearInterval(timer);
        };
      }, []);
      return [state, setState];
    }

    // Memory hall: a corridor of walls built with plain CSS 3D. No library, no
    // build step, no external resource: perspective + preserve-3d + one float
    // keyframe, reusing the glass-ball optics the old shelf already had.
    // Geometry: a 5x5 front wall, the side face of the next (older) wall on the
    // right, and a base band under both. One wheel step turns the whole wall.
    const BALL_CSS = [
'@keyframes msFloat{0%,100%{translate:0 0}50%{translate:0 -.030em}}',
'@keyframes msDevelop{0%{opacity:0;transform:scale(.70);filter:blur(.08em)}45%{opacity:1}100%{opacity:1;transform:scale(1);filter:blur(0)}}',
'@keyframes msWait{0%,100%{opacity:.55}50%{opacity:1}}',
'.ms-panel{padding:16px;line-height:1.7}',
'.ms-counts{margin:0 0 10px;opacity:.85}',
'.ms-hall{--wall-w:320px;--wall-h:290px;--stage-h:334px;--case-1:#f7f1e6;--case-2:#e6dac6;--case-edge:rgba(255,255,255,.9);',
'--wall-1:#efe4d2;--wall-2:#ddcbb0;--wall-3:#b99a72;--plank:rgba(92,64,30,.26);--post-1:#c9a77a;--post-2:#7d5f3d;',
'--base-1:#a5855c;--base-2:#5f4529;--rim:rgba(255,255,255,.55);--light:rgba(255,246,226,.55);',
'--cushion-edge:rgba(0,0,0,.55);--cushion-rim:rgba(255,255,255,.75);',
'--empty-dark:rgba(46,30,14,.44);--empty-rim:rgba(255,255,255,.60);--empty-glow:rgba(255,232,196,.30);',
'--vignette:rgba(62,42,20,.20);--focus:#2f7bff;margin:0 0 10px}',
'@media (prefers-color-scheme:dark){.ms-hall{--case-1:#121521;--case-2:#060810;--case-edge:rgba(150,185,255,.16);',
'--wall-1:#1b1f2c;--wall-2:#12151f;--wall-3:#0a0c13;--plank:rgba(150,190,255,.10);--post-1:#2e261d;--post-2:#120e0a;',
'--base-1:#20242f;--base-2:#080a10;--rim:rgba(150,190,255,.30);--light:rgba(120,170,255,.10);',
'--cushion-edge:rgba(0,0,0,.70);--cushion-rim:var(--ms-rim);--vignette:rgba(0,0,0,.55);',
'--empty-dark:rgba(0,0,0,.50);--empty-rim:rgba(190,220,255,.30);--empty-glow:rgba(150,195,255,.32);',
'--focus:#6ea6ff}}',
'.ms-hall-stage-wrap{position:relative;border-radius:14px;overflow:hidden;box-shadow:0 20px 36px -30px rgba(4,8,18,.6)}',
'.ms-hall-stage{position:relative;height:var(--stage-h,334px);overflow:hidden;perspective:1000px;perspective-origin:47% 56%;',
'background:radial-gradient(90% 70% at 46% 0%,var(--light),transparent 62%),linear-gradient(180deg,var(--case-1),var(--case-2));',
'box-shadow:inset 0 1px 0 var(--case-edge)}',
'.ms-hall-world{position:absolute;inset:0;left:-2%;transform-style:preserve-3d}',
'.ms-hall-wall{position:absolute;left:50%;top:50%;width:var(--wall-w);height:var(--wall-h);',
'transform:translate(-50%,-50%) translate3d(var(--tx,0px),0,var(--tz,0px)) rotateY(var(--rot,0deg));',
'transform-style:preserve-3d;border-radius:7px;transition:transform .55s cubic-bezier(.22,.72,.2,1),opacity .22s ease,visibility 0s;',
'background:linear-gradient(180deg,var(--wall-1) 0%,var(--wall-2) 58%,var(--wall-3) 100%);',
'box-shadow:inset 0 1px 0 var(--rim),inset 0 -14px 30px -18px rgba(0,0,0,.55),0 18px 40px -18px rgba(0,0,0,.55)}',
'.ms-hall-wall::before{content:"";position:absolute;inset:0;border-radius:7px;pointer-events:none;',
'box-shadow:inset 0 0 0 1px rgba(0,0,0,.22),inset 0 0 46px rgba(60,40,18,.22)}',
'.ms-hall-wall::after{content:"";position:absolute;top:-5px;bottom:-5px;right:-7px;width:11px;border-radius:3px;pointer-events:none;',
'background:linear-gradient(90deg,var(--post-1),var(--post-2));',
'box-shadow:inset 1px 0 0 rgba(255,255,255,.30),0 0 16px rgba(0,0,0,.32),0 8px 14px -8px rgba(0,0,0,.55)}',
'.ms-hall-wall[data-r="1"]{--tx:calc(var(--wall-w) * .72);--tz:calc(var(--wall-w) * -.62);--rot:-62deg}',
'.ms-hall-wall[data-r="-1"]{--tx:calc(var(--wall-w) * -.72);--tz:calc(var(--wall-w) * -.62);--rot:62deg}',
'.ms-hall[data-rest="1"] .ms-hall-wall[data-r="-1"]{opacity:0;visibility:hidden;transition:opacity .18s ease,visibility 0s .18s}',
'.ms-hall-grid{position:absolute;inset:14px 16px 12px;display:grid;grid-template-columns:repeat(5,1fr);',
'grid-template-rows:repeat(5,1fr);transform-style:preserve-3d;',
'background-image:repeating-linear-gradient(180deg,transparent 0 calc(20% - 8px),rgba(255,255,255,.18) calc(20% - 8px),rgba(255,255,255,.04) calc(20% - 3px),transparent calc(20% - 3px) 20%),',
'repeating-linear-gradient(180deg,transparent 0 calc(20% - 3px),var(--plank) calc(20% - 3px),var(--plank) 20%)}',
'.ms-slot{position:relative;display:flex;align-items:flex-end;justify-content:center;transform-style:preserve-3d;cursor:pointer}',
'.ms-cushion{position:absolute;left:50%;bottom:0;pointer-events:none;width:calc(var(--ms-size) * 1.35);height:calc(var(--ms-size) * 1.35);',
'border-radius:50%;transform:translate(-50%,4%) translateZ(.8px);',
'background:radial-gradient(circle at 50% 40%,rgba(255,255,255,.16) 0%,rgba(255,255,255,.05) 20%,rgba(0,0,0,.22) 44%,var(--cushion-edge) 82%,rgba(0,0,0,.25) 100%);',
'box-shadow:0 0 0 1px var(--cushion-rim),0 0 0 2px rgba(0,0,0,.28),0 0 14px 2px var(--ms-glow,transparent)}',
'.ms-stand{position:absolute;bottom:0;left:50%;width:var(--ms-size);height:var(--ms-size);margin-left:calc(var(--ms-size) / -2);',
'transform-origin:50% 100%;transform:translateZ(calc(var(--ms-size) * -0.18)) rotateX(-62deg);transform-style:preserve-3d}',
'.ms-lip{position:absolute;left:50%;bottom:0;pointer-events:none;width:calc(var(--ms-size) * 1.35);height:calc(var(--ms-size) * 1.35);',
'border-radius:50%;transform:translate(-50%,4%) translateZ(calc(var(--ms-size) * .22));',
'background:radial-gradient(circle at 50% 50%,rgba(0,0,0,0) 52%,var(--ms-cushion-lip,rgba(0,0,0,.5)) 66%,rgba(0,0,0,.18) 74%,transparent 80%);',
'-webkit-mask:linear-gradient(180deg,#000 40%,transparent 78%);mask:linear-gradient(180deg,#000 40%,transparent 78%)}',
'.ms-ball{display:block;width:100%;height:100%;font-size:var(--ms-size);position:relative;border:0;padding:0;border-radius:50%;cursor:pointer;',
'background:radial-gradient(circle at var(--ms-rx) var(--ms-ry),rgba(255,255,255,.95) 0,rgba(255,255,255,.70) .028em,rgba(255,255,255,.22) .062em,rgba(255,255,255,0) .11em),',
'radial-gradient(circle at 50% 48%,transparent 48%,var(--ms-edge) 88%,var(--ms-edge) 100%),',
'linear-gradient(var(--ms-gangle,142deg),var(--ms-hi) 0%,var(--ms-core) 30%,var(--ms-mid) 68%,var(--ms-lo) 100%),',
'radial-gradient(circle at 50% 122%,rgba(255,255,255,.45),rgba(255,255,255,0) 42%);',
'box-shadow:inset 0 0 0 .020em rgba(255,255,255,.30),inset .05em .07em .14em rgba(255,255,255,.34),',
'inset -.07em -.10em .20em -.02em var(--ms-dark),inset -.02em -.04em .07em rgba(255,255,255,.42),',
'0 0 18px 2px var(--ms-glow),var(--ms-extra,0 0 0 0 transparent);',
'transition:box-shadow .16s ease,filter .16s ease;-webkit-tap-highlight-color:transparent;',
'animation:msFloat var(--ms-dur,5s) cubic-bezier(.45,0,.55,1) infinite var(--ms-delay,0s)}',
'.ms-ball::before{content:"";position:absolute;inset:0;border-radius:50%;pointer-events:none;filter:blur(.004em);',
'background:conic-gradient(from calc(var(--ms-arc) - 44deg) at 50% 50%,rgba(255,255,255,0) 0deg,rgba(255,255,255,.14) 10deg,',
'rgba(255,255,255,.92) 28deg,#fff 40deg,rgba(255,255,255,.62) 54deg,rgba(255,255,255,0) 74deg);',
'-webkit-mask:radial-gradient(circle closest-side at 50% 50%,transparent 70%,#000 80%,#000 90%,transparent 95%);',
'mask:radial-gradient(circle closest-side at 50% 50%,transparent 70%,#000 80%,#000 90%,transparent 95%)}',
'.ms-ball::after{content:"";position:absolute;inset:-.045em;border-radius:50%;pointer-events:none;opacity:0;transition:opacity .25s ease;',
'box-shadow:0 0 0 .045em rgba(255,255,255,.55),0 0 .60em .16em var(--ms-glow),inset 0 0 .50em rgba(255,255,255,.25)}',
'.ms-ball[aria-pressed="true"]::after{opacity:1;animation:msDevelop .60s cubic-bezier(.2,.8,.2,1)}',
'.ms-ball:hover,.ms-ball:focus-visible{transform:scale(1.06);--ms-extra:0 0 .55em .10em var(--ms-glow)}',
'.ms-ball:focus-visible{outline:2px solid var(--focus);outline-offset:3px}',
'.ms-ball[aria-pressed="true"]{transform:scale(1.06);filter:saturate(1.22) brightness(1.10)}',
'.ms-empty{position:relative;display:flex;align-items:flex-end;justify-content:center}',
'.ms-empty::before{content:"";width:calc(var(--ms-size) * 1.1);height:calc(var(--ms-size) * 1.1);border-radius:50%;',
'background:radial-gradient(circle at 50% 36%,rgba(255,255,255,.14) 0%,rgba(255,255,255,.02) 34%,var(--empty-dark) 82%,rgba(0,0,0,.10) 100%);',
'box-shadow:0 0 0 1px var(--empty-rim),0 0 0 2px rgba(0,0,0,.16),inset 0 3px 6px rgba(0,0,0,.28),inset 0 -3px 7px var(--empty-glow);',
'animation:msWait 3.4s ease-in-out infinite;animation-delay:var(--ms-delay,0s)}',
'.ms-hall-base{position:absolute;left:0;right:0;bottom:0;height:26px;pointer-events:none;',
'background:linear-gradient(180deg,var(--base-1),var(--base-2));',
'box-shadow:inset 0 1px 0 rgba(255,255,255,.22),0 -8px 18px -10px rgba(0,0,0,.6)}',
'.ms-hall-base::after{content:"";position:absolute;left:4%;right:4%;top:-3px;height:3px;border-radius:2px;',
'background:linear-gradient(90deg,transparent,var(--rim),transparent);opacity:.6}',
'.ms-hall-light{position:absolute;inset:0;pointer-events:none;background:radial-gradient(70% 60% at 46% -8%,var(--light),transparent 70%)}',
'.ms-hall-vignette{position:absolute;inset:0;pointer-events:none;border-radius:14px;',
'background:radial-gradient(120% 100% at 46% 34%,transparent 40%,var(--vignette,rgba(0,0,0,.25)))}',
'.ms-hall-nav{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 2px 0;font-size:.92em}',
'.ms-hall-btn{padding:4px 10px;border-radius:999px;border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.08);',
'color:inherit;font:inherit;cursor:pointer}',
'.ms-hall-btn:disabled{opacity:.35;cursor:default}',
'.ms-hall-btn:focus-visible{outline:2px solid var(--focus);outline-offset:2px}',
'.ms-hall-pos{opacity:.75}',
'.ms-card{margin-top:10px;padding:12px 14px;border-radius:10px;background:rgba(127,127,127,.08);font-size:.95em}',
'.ms-hint{opacity:.75;margin:6px 0 0}',
'.ms-search{width:100%;box-sizing:border-box;padding:7px 10px;margin:0 0 12px;border-radius:8px;border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.06);color:inherit;font:inherit}',
'.ms-row{display:block;width:100%;text-align:left;padding:8px 10px;margin:0 0 6px;border-radius:8px;cursor:pointer;border:1px solid transparent;background:rgba(127,127,127,.06);color:inherit;font:inherit}',
'.ms-row:hover,.ms-row:focus-visible{border-color:rgba(63,167,255,.55);outline:none}',
'.ms-kind{opacity:.65;margin-right:6px;font-size:.9em}',
'.ms-muted{opacity:.65}',
'@media (prefers-reduced-motion:reduce){.ms-hall-wall{transition:none !important}',
'.ms-ball,.ms-ball::after,.ms-empty::before{animation:none !important;transition:none !important}}',
].join('');

    const HALL_SIZE = 25;              // 5 rows x 5 columns = one wall
    const HALL_COLUMNS = 5;
    const WHEEL_STEP = 24;             // a wheel gesture must travel this far to count
    const WHEEL_LOCK_MS = 560;         // one wall per gesture: lock while it slides
    // 固定 7 色 token 表：色相固定、明度高、饱和低；暗部用同色相加深，不压黑。
    const BALL_TYPES = {
      identity:  { label: '身份', hi: '#dae5f1', core: '#b1cae7', mid: '#7caade', lo: '#3573bb', glow: 'rgba(80,160,240,.35)' },
      preference:{ label: '偏好', hi: '#f1e9da', core: '#e7d3b1', mid: '#deba7c', lo: '#bb8a35', glow: 'rgba(235,180,90,.35)' },
      episode:   { label: '经历', hi: '#daf1ee', core: '#b1e7df', mid: '#7cded1', lo: '#35bba9', glow: 'rgba(90,235,220,.35)' },
      promise:   { label: '承诺', hi: '#f1dae0', core: '#e7b1c0', mid: '#de7c97', lo: '#bb3559', glow: 'rgba(235,110,150,.35)' },
      fact:      { label: '事实', hi: '#daf1e2', core: '#b1e7c5', mid: '#7cdea0', lo: '#35bb66', glow: 'rgba(100,235,150,.35)' },
      emotion:   { label: '情绪', hi: '#f1daed', core: '#e7b1de', mid: '#de7cce', lo: '#bb35a5', glow: 'rgba(235,110,215,.35)' },
      procedure: { label: '做法', hi: '#e4daf1', core: '#c8b1e7', mid: '#a77cde', lo: '#6f35bb', glow: 'rgba(170,120,240,.35)' },
      other:     { label: '其它', hi: '#e3e5e8', core: '#c5c9d3', mid: '#9ba6bf', lo: '#626f8d', glow: 'rgba(130,160,220,.28)' },
    };
    const CARD_TEXT_LIMIT = 120;

    function ballHash(text) {
      let hashValue = 2166136261;
      const source = String(text ?? '');
      for (let index = 0; index < source.length; index += 1) {
        hashValue ^= source.charCodeAt(index);
        hashValue = Math.imul(hashValue, 16777619);
      }
      return hashValue >>> 0;
    }
    function ballOffset(hashValue, shift) { return ((hashValue >>> shift) & 7) - 3; }
    function ballClamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
    function ballRgba(hex, alpha) {
      const value = parseInt(hex.slice(1), 16);
      return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
    }
    function ballPalette(type) { return BALL_TYPES[type] || BALL_TYPES.other; }
    function ballTier(memory, index) {
      const weight = typeof memory.weight === 'number' && isFinite(memory.weight)
        ? ballClamp(memory.weight, 0, 1) : null;
      if (weight === null) return Math.min(index, 3);
      const stamp = Date.parse(memory.recorded_at);
      const recency = isFinite(stamp)
        ? ballClamp(1 - (Date.now() - stamp) / 86400000 / 60, 0, 1) : 0.5;
      const score = 0.7 * weight + 0.3 * recency;
      if (score >= 0.72) return 0;
      if (score >= 0.50) return 1;
      if (score >= 0.30) return 2;
      return 3;
    }
    function ballDayLabel(stamp) {
      const value = Date.parse(stamp);
      if (!isFinite(value)) return '未知时间';
      const date = new Date(value);
      return `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, '0')}`;
    }
    // Sizes follow the measured wall width; weight still adds a small step so a
    // heavy memory keeps the slightly larger ball it had on the shelf.
    function ballVars(memory, index, row, baseSize) {
      const palette = ballPalette(memory.type);
      const tier = ballTier(memory, index);
      const size = Math.max(20, Math.round(baseSize * [1, 0.94, 0.88, 0.82][tier]));
      const hashValue = ballHash(memory.id);
      const lx = ballClamp(32 + ballOffset(hashValue, 0) / size * 100, 24, 42);
      const ly = ballClamp(27 + ballOffset(hashValue, 4) / size * 100, 19, 36);
      const arc = Math.atan2(lx - 50, -(ly - 50)) * 180 / Math.PI;
      const gangle = Math.atan2(50 - lx, ly - 50) * 180 / Math.PI;
      return {
        '--ms-size': `${size}px`,
        '--ms-hi': ballRgba(palette.hi, .92),
        '--ms-core': ballRgba(palette.core, .90),
        '--ms-mid': ballRgba(palette.mid, .90),
        '--ms-lo': ballRgba(palette.lo, .96),
        '--ms-dark': ballRgba(palette.lo, .62),
        '--ms-edge': ballRgba(palette.lo, .48),
        '--ms-glow': palette.glow,
        '--ms-rim': ballRgba(palette.mid, .30),
        '--ms-cushion-lip': `rgba(0,0,0,${(0.50 + Math.min(4, row) * 0.05).toFixed(2)})`,
        '--ms-gangle': `${gangle.toFixed(0)}deg`,
        '--ms-lx': `${lx.toFixed(1)}%`,
        '--ms-ly': `${ly.toFixed(1)}%`,
        '--ms-rx': `${ballClamp(100 - lx, 54, 78).toFixed(1)}%`,
        '--ms-ry': `${ballClamp(100 - ly + 8, 58, 86).toFixed(1)}%`,
        '--ms-arc': `${arc.toFixed(0)}deg`,
        '--ms-delay': `${(index % HALL_SIZE) * 110}ms`,
        '--ms-dur': `${(4.9 + (hashValue % 5) * 0.1).toFixed(1)}s`,
      };
    }

    // One wall is 25 balls; the frame is measured so the side face of the next
    // wall still fits on the right of a narrow sidebar.
    function hallMetrics(width) {
      const stageWidth = width > 0 ? width : 340;
      const wallWidth = Math.round(Math.min(560, Math.max(210, stageWidth - 84)));
      const column = (wallWidth - 32) / HALL_COLUMNS;
      const ballBase = Math.round(Math.min(44, Math.max(22, column / 1.35)));
      const wallHeight = Math.round(ballBase * 1.35 * 5 + 34);
      return { stageWidth, wallWidth, ballBase, wallHeight };
    }
    function hallWallCount(total) {
      return Math.max(1, Math.ceil(Math.max(0, Number(total) || 0) / HALL_SIZE));
    }
    function hallHasNext(wall, total) {
      return (wall + 1) * HALL_SIZE < Math.max(0, Number(total) || 0);
    }
    function hallIndex(wall, cell) {
      return wall * HALL_SIZE + cell;
    }
    function hallCells(items) {
      const cells = new Array(HALL_SIZE).fill(null);
      const list = Array.isArray(items) ? items : [];
      for (let index = 0; index < Math.min(list.length, HALL_SIZE); index += 1) cells[index] = list[index];
      return cells;
    }

    function useHallLayout() {
      const [width, setWidth] = React.useState(0);
      const nodeRef = React.useRef(null);
      const observerRef = React.useRef(null);
      // Callback ref: the stage only mounts after the summary arrives, so an
      // effect with [] would run while the node is still null and never re-run.
      const measure = React.useCallback((node) => {
        if (observerRef.current) {
          observerRef.current.disconnect();
          observerRef.current = null;
        }
        nodeRef.current = node;
        if (!node || typeof node.clientWidth !== 'number') return;
        const apply = (value) => setWidth(value > 0 ? value : 0);
        apply(node.clientWidth);
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver((entries) => {
          const entry = entries && entries[0];
          apply(entry && entry.contentRect ? entry.contentRect.width : node.clientWidth);
        });
        observer.observe(node);
        observerRef.current = observer;
      }, []);
      return [width, nodeRef, measure];
    }

    function ballReduced() {
      return typeof window !== 'undefined' && window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }


    function SearchResults({ query, onOpen, openId }) {
      const [result, setResult] = React.useState(null);
      const [failed, setFailed] = React.useState(false);
      React.useEffect(() => {
        if (!query) return undefined;
        let alive = true;
        let timer = null;
        const run = () => {
          fetch(SEARCH + '?q=' + encodeURIComponent(query))
            .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
            .then((data) => {
              if (!alive) return;
              setFailed(false);
              setResult(Array.isArray(data?.items) ? data.items : []);
            })
            .catch(() => {
              if (alive) setFailed(true);
            });
        };
        timer = setTimeout(run, 250);
        return () => {
          alive = false;
          clearTimeout(timer);
        };
      }, [query]);
      if (failed) return h('p', { className: 'ms-muted' }, '搜索不可用');
      if (result === null) return h('p', { className: 'ms-muted' }, '搜索中…');
      if (result.length === 0) return h('p', { className: 'ms-muted' }, '没找到匹配的记忆');
      return h('div', { role: 'list', 'aria-label': '搜索结果' },
        result.map((item) => {
          const open = openId === item.id;
          const body = Array.from(String(item.text ?? '')).slice(0, CARD_TEXT_LIMIT).join('');
          return h('button', {
            key: item.id,
            type: 'button',
            role: 'listitem',
            className: 'ms-row',
            'aria-expanded': open,
            onClick: () => onOpen(open ? null : item.id),
          },
          h('span', { className: 'ms-kind' }, '[' + (item.kind ?? 'memory') + ']'),
          h('span', null, open ? body : Array.from(body).slice(0, 40).join('') + (body.length > 40 ? '…' : '')),
          );
        }));
    }

    function MemoryPanel() {
      const [state] = useSummary();
      const [selectedId, setSelectedId] = React.useState(null);
      const [detail, setDetail] = React.useState(null);
      const [query, setQuery] = React.useState('');
      const [openResultId, setOpenResultId] = React.useState(null);
      const [stageWidth, stageNodeRef, measureStage] = useHallLayout();
      const [pages, setPages] = React.useState({});
      const [wall, setWall] = React.useState(0);
      const [rest, setRest] = React.useState(true);
      const [pageFailed, setPageFailed] = React.useState(false);
      const mounted = React.useRef(true);
      const restRef = React.useRef(true);
      const wallRef = React.useRef(0);
      const totalRef = React.useRef(0);
      const pendingRef = React.useRef(0);
      const wheelAcc = React.useRef(0);
      const moveTimer = React.useRef(null);
      const fetching = React.useRef(new Set());
      const stepRef = React.useRef(null);
      const seenTotal = React.useRef(null);

      const total = state?.total ?? state?.memories ?? 0;
      const wallCount = hallWallCount(total);
      const metrics = hallMetrics(stageWidth);
      const ready = Boolean(state) && !state?.error;
      restRef.current = rest;
      wallRef.current = wall;
      totalRef.current = total;

      React.useEffect(() => {
        mounted.current = true;
        return () => {
          mounted.current = false;
          if (moveTimer.current) clearTimeout(moveTimer.current);
        };
      }, []);

      // Front wall plus the side face of the next (older) wall. Deeper walls are
      // not fetched until the wheel brings them in; coming back hits the cache.
      React.useEffect(() => {
        if (!state || state.error || total <= 0) return undefined;
        const wanted = [wall];
        if (hallHasNext(wall, total)) wanted.push(wall + 1);
        for (const index of wanted) {
          if (pages[index] || fetching.current.has(index)) continue;
          fetching.current.add(index);
          fetch(API + '?offset=' + index * HALL_SIZE + '&limit=' + HALL_SIZE)
            .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
            .then((data) => {
              if (!mounted.current) return;
              // An older host answers the plain summary here; that is not a page.
              if (!data || !Array.isArray(data.items)) throw new Error('page_not_paged');
              setPageFailed(false);
              setPages((current) => ({ ...current, [index]: data.items }));
            })
            .catch(() => {
              if (mounted.current) setPageFailed(true);
            })
            .then(() => {
              fetching.current.delete(index);
            });
        }
        return undefined;
      }, [state, wall, total, pages]);

      // A new memory shifts every offset, so drop the page cache once total moves.
      React.useEffect(() => {
        if (!state || state.error) return;
        const nextTotal = state.total ?? null;
        if (seenTotal.current !== null && nextTotal !== null && seenTotal.current !== nextTotal) {
          setPages({});
          setWall(0);
          setSelectedId(null);
          setDetail(null);
        }
        seenTotal.current = nextTotal;
      }, [state]);

      const finishMove = () => {
        restRef.current = true;
        setRest(true);
        const next = pendingRef.current;
        pendingRef.current = 0;
        if (next) stepRef.current(next);
      };
      const step = (direction) => {
        const target = wallRef.current + direction;
        if (target < 0 || target >= hallWallCount(totalRef.current)) return;
        setWall(target);
        if (ballReduced()) {
          restRef.current = true;
          setRest(true);
          pendingRef.current = 0;
          return;
        }
        restRef.current = false;
        setRest(false);
        if (moveTimer.current) clearTimeout(moveTimer.current);
        moveTimer.current = setTimeout(finishMove, WHEEL_LOCK_MS);
      };
      stepRef.current = step;

      // React attaches wheel listeners passively, so preventDefault there is a
      // no-op: use a native non-passive listener. One gesture = one whole wall.
      React.useEffect(() => {
        const node = stageNodeRef.current;
        if (!node || typeof node.addEventListener !== 'function') return undefined;
        const onWheel = (event) => {
          event.preventDefault();
          const direction = event.deltaY > 0 ? 1 : -1;
          if (!restRef.current) {
            pendingRef.current = direction;
            return;
          }
          wheelAcc.current += event.deltaY;
          if (Math.abs(wheelAcc.current) < WHEEL_STEP) return;
          const dir = wheelAcc.current > 0 ? 1 : -1;
          wheelAcc.current = 0;
          stepRef.current(dir);
        };
        node.addEventListener('wheel', onWheel, { passive: false });
        return () => node.removeEventListener('wheel', onWheel);
      }, [stageWidth, query, ready]);

      if (!state) return h('p', { className: 'ms-panel' }, '读取记忆…');
      if (state.error) return h('p', { className: 'ms-panel' }, '暂时读不到记忆数据。');

      const openMemory = (memory, pageItems) => {
        setSelectedId(memory.id);
        setDetail({ id: memory.id, status: 'loading', text: null, type: memory.type, recorded_at: memory.recorded_at });
        resolveMemory(memory.id, pageItems, fetchMemory)
          .then((item) => {
            if (!mounted.current) return;
            setDetail((current) => (current && current.id === memory.id
              ? {
                id: memory.id,
                status: 'ok',
                text: item?.text ?? memory.text,
                type: item?.type ?? memory.type,
                recorded_at: item?.recorded_at ?? memory.recorded_at,
              }
              : current));
          })
          .catch(() => {
            if (!mounted.current) return;
            setDetail((current) => (current && current.id === memory.id
              ? { id: memory.id, status: 'error', text: null }
              : current));
          });
      };

      const slotNode = (memory, index, row, pageItems) => {
        const palette = ballPalette(memory.type);
        const pressed = selectedId === memory.id;
        return h('span', {
          key: `slot-${memory.id}`,
          className: 'ms-slot',
          role: 'listitem',
          style: ballVars(memory, index, row, metrics.ballBase),
          // Decoration layers are pointer-events:none, so a click lands here.
          // The handler lives on the slot: the ball must not toggle twice.
          onClick: () => {
            if (pressed) {
              setSelectedId(null);
              setDetail(null);
              return;
            }
            openMemory(memory, pageItems);
          },
        },
        h('span', { className: 'ms-cushion', 'aria-hidden': true }),
        h('span', { className: 'ms-stand' },
          h('button', {
            type: 'button',
            className: 'ms-ball',
            'aria-pressed': pressed,
            'aria-label': `${memory.text}（${palette.label} · ${ballDayLabel(memory.recorded_at)}）`,
            title: `${memory.text} · ${palette.label} · ${ballDayLabel(memory.recorded_at)}`,
            'data-type': memory.type,
          })),
        h('span', { className: 'ms-lip', 'aria-hidden': true }));
      };

      const emptyNode = (key, delay) => h('span', {
        key,
        className: 'ms-empty',
        'aria-hidden': true,
        style: { '--ms-size': `${metrics.ballBase}px`, '--ms-delay': `${delay * 90}ms` },
      });

      const wallNode = (pageIndex, relative) => {
        const items = pages[pageIndex] ?? null;
        const cells = hallCells(items);
        const slots = cells.map((memory, cell) => (memory
          ? slotNode(memory, hallIndex(pageIndex, cell), Math.floor(cell / HALL_COLUMNS), items)
          : emptyNode(`empty-${pageIndex}-${cell}`, cell)));
        return h('div', {
          key: `wall-${pageIndex}`,
          className: 'ms-hall-wall',
          'data-r': String(relative),
          role: 'group',
          'aria-label': `第 ${pageIndex + 1} 面记忆墙`,
          'aria-hidden': relative === -1 ? 'true' : undefined,
        },
        h('div', {
          className: 'ms-hall-grid',
          role: 'list',
          'aria-label': `第 ${pageIndex + 1} 面，共 ${items ? items.length : 0} 条`,
        }, slots));
      };

      const walls = [];
      for (const relative of [-1, 0, 1]) {
        const pageIndex = wall + relative;
        if (pageIndex < 0 || pageIndex >= wallCount) continue;
        if (relative === 1 && !hallHasNext(wall, total)) continue;
        walls.push(wallNode(pageIndex, relative));
      }

      const hall = h('div', {
        className: 'ms-hall',
        role: 'region',
        'aria-label': '记忆走廊',
        'data-rest': rest ? '1' : '0',
        style: {
          '--wall-w': `${metrics.wallWidth}px`,
          '--wall-h': `${metrics.wallHeight}px`,
          '--stage-h': `${metrics.wallHeight + 44}px`,
        },
      },
      h('div', { className: 'ms-hall-stage-wrap' },
        h('div', { className: 'ms-hall-stage', ref: measureStage },
          h('div', { className: 'ms-hall-world' }, walls),
          h('div', { className: 'ms-hall-base', 'aria-hidden': true })),
        h('div', { className: 'ms-hall-light', 'aria-hidden': true }),
        h('div', { className: 'ms-hall-vignette', 'aria-hidden': true })),
      h('div', { className: 'ms-hall-nav' },
        h('button', {
          type: 'button',
          className: 'ms-hall-btn',
          disabled: wall === 0,
          onClick: () => step(-1),
        }, '← 更新'),
        h('span', { className: 'ms-hall-pos', role: 'status', 'aria-live': 'polite' },
          `第 ${wall + 1} 面 / 共 ${wallCount} 面`),
        h('button', {
          type: 'button',
          className: 'ms-hall-btn',
          disabled: !hallHasNext(wall, total),
          onClick: () => step(1),
        }, '更旧 →')));

      return h(
        'div',
        { className: 'ms-panel' },
        h('style', { dangerouslySetInnerHTML: { __html: BALL_CSS } }),
        h('h2', { style: { margin: '0 0 8px' } }, '记忆'),
        h('p', { className: 'ms-counts' },
          `记忆 ${total} 条 · 每面 ${HALL_SIZE} 条 · 候选 ${state.candidates} 条 · 待确认惦记 ${state.pending_due} 条`),
        h('input', {
          className: 'ms-search',
          type: 'search',
          value: query,
          placeholder: '搜记忆…',
          'aria-label': '搜记忆',
          onChange: (event) => setQuery(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter') setQuery(event.currentTarget.value);
          },
        }),
        query
          ? h(SearchResults, { query, openId: openResultId, onOpen: setOpenResultId })
          : hall,
        query || !pageFailed
          ? null
          : h('p', { className: 'ms-muted' }, '这一面暂时读不出来，稍后再滚一次'),
        query
          ? null
          : h('p', { className: 'ms-hint' },
            total === 0
              ? '还没有记忆。去跟模型说一句「记住：…」吧'
              : '滚轮翻墙：往前更旧、往后更新；点亮一颗球看正文，再点一次收起。'),
        !query && detail
          ? h('div', { className: 'ms-card', key: detail.id, role: 'status', 'aria-live': 'polite' },
            detail.status === 'loading'
              ? '读取中…'
              : detail.status === 'error'
                ? '这条读不出来了'
                : h('div', null,
                  h('p', { style: { margin: 0 } },
                    Array.from(String(detail.text ?? '')).slice(0, CARD_TEXT_LIMIT).join('')),
                  h('p', { className: 'ms-muted', style: { margin: '4px 0 0' } },
                    `${ballPalette(detail.type).label} · ${ballDayLabel(detail.recorded_at)}`)))
          : null,
      );
    }

    function MemoryIcon() {
      return h('span', { 'aria-hidden': true, role: 'img', title: '记忆' }, '🐳');
    }

    const SOURCE_LABEL = { 'ui-config': '设置文件', profile: 'profile 配置', default: '默认值' };

    // key, 名字, 一句人话, 生效时机（别糊成"立即生效"，四个模块真的要重启）
    const MODULE_ROWS = [
      ['context', '自动注入', '每轮把记忆摘要注入系统提示；关掉后只能手动查', '改完立即生效'],
      ['read', '读取工具', '关掉后查询类工具（get / search / review）不可用', '下次启动生效'],
      ['write', '写入工具', '关掉后不再记录新记忆，候选也收', '改完立即生效'],
      ['dream', '做梦', '关掉后不浮现、也不能记录梦', '下次启动生效'],
      ['projects', '项目', '关掉后项目视角不可用', '下次启动生效'],
      ['due', '待确认惦记', '关掉后不提醒到期的惦记，也不能确认或搁置', '下次启动生效'],
      ['feed', '信息流', '关掉后不产出信息流候选', '下次启动生效'],
    ];

    // Third settings block: the owner-only, versioned persona text. A save
    // always appends v(n+1); old versions stay on disk and are listed below.
    function PersonaSettings() {
      const [state, setState] = React.useState(null);
      const [draft, setDraft] = React.useState('');
      const [note, setNote] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      React.useEffect(() => {
        fetch(PERSONA)
          .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
          .then((body) => {
            setState(body);
            setDraft(body.text ?? '');
          })
          .catch(() => setState({ error: true }));
      }, []);
      const reload = () =>
        fetch(PERSONA)
          .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
          .then((body) => {
            setState(body);
            setDraft(body.text ?? '');
          })
          .catch(() => setState({ error: true }));
      const save = () => {
        setBusy(true);
        setNote('保存中…');
        fetch(PERSONA, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: draft }),
        })
          .then((response) =>
            response.ok ? response.json() : response.json().then((body) => Promise.reject(new Error(body?.error ?? String(response.status)))),
          )
          .then((body) => {
            setNote(`已保存 v${body.version}`);
            return reload();
          })
          .catch((err) => setNote(`保存失败（${err?.message ?? 'unknown'}）`))
          .then(() => setBusy(false));
      };
      const view = (version) => {
        setBusy(true);
        fetch(`${PERSONA}?version=${version}`)
          .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
          .then((body) => {
            setDraft(body.text ?? '');
            setNote(`正在查看 v${version}；保存会新建 v${(state?.version ?? version) + 1}，旧版不会被覆盖`);
          })
          .catch(() => setNote('版本读取失败'))
          .then(() => setBusy(false));
      };
      const reset = () => {
        setDraft(state?.text ?? '');
        setNote('已回到当前版本');
      };
      const versions = state?.versions ?? [];
      const unavailable = state?.error === true;
      const chars = Array.from(draft).length;
      return h(
        'div',
        { style: { margin: '18px 0 0', paddingTop: 14, borderTop: '1px solid rgba(127,127,127,.28)' } },
        h('h3', { style: { margin: '0 0 6px' } }, '人格'),
        h('p', { style: { margin: '0 0 8px', opacity: 0.75 } },
          unavailable
            ? '人格接口不可用（本 profile 没有 Web 服务或插件版本过旧）'
            : state?.version
              ? `当前 v${state.version}${state.source === 'packaged' ? '（出厂种子）' : ''}；保存会新建 v${state.version + 1}，旧版本一直保留。`
              : '还没有主人写的人格文本；写一段保存后成为 v1。'),
        h('textarea', {
          value: draft,
          disabled: unavailable || busy,
          rows: 10,
          placeholder: '只写「你是谁、怎么说话、什么边界」，不写工具用法和一次性任务。',
          'aria-label': '人格文本',
          onChange: (event) => setDraft(event.target.value),
          style: {
            width: '100%',
            boxSizing: 'border-box',
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid rgba(127,127,127,.35)',
            background: 'rgba(127,127,127,.06)',
            color: 'inherit',
            font: 'inherit',
            lineHeight: 1.6,
            resize: 'vertical',
          },
        }),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0 0', flexWrap: 'wrap' } },
          h('button', {
            type: 'button',
            disabled: unavailable || busy || draft.trim().length === 0,
            onClick: save,
          }, busy ? '保存中…' : '保存为新版本'),
          h('button', { type: 'button', disabled: unavailable || busy, onClick: reset }, '回到当前版本'),
          h('span', { style: { opacity: 0.7, fontSize: '0.92em' } }, `${chars} 字（注入上限 3000 字，超长自动截断）`),
        ),
        note ? h('p', { style: { opacity: 0.75, margin: '6px 0 0' } }, note) : null,
        versions.length > 0
          ? h('div', { style: { margin: '12px 0 0' } },
            h('p', { style: { margin: '0 0 6px', opacity: 0.75 } }, '版本历史（点开只读，不覆盖任何旧版）'),
            versions.map((item) =>
              h('button', {
                key: item.version,
                type: 'button',
                disabled: unavailable || busy,
                onClick: () => view(item.version),
                title: item.at ? new Date(item.at).toLocaleString() : '',
                style: {
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 10px',
                  margin: '0 0 6px',
                  borderRadius: 8,
                  border: '1px solid transparent',
                  background: 'rgba(127,127,127,.06)',
                  color: 'inherit',
                  font: 'inherit',
                  cursor: 'pointer',
                },
              }, `v${item.version} · ${item.source === 'packaged' ? '出厂种子' : '本地'} · ${item.bytes ?? '?'} 字节`),
            ),
          )
          : null,
      );
    }

    function MemorySettings() {
      const [state, setState] = React.useState(null);
      const [note, setNote] = React.useState('');
      React.useEffect(() => {
        fetch(API)
          .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
          .then(setState)
          .catch(() => setState({ error: true }));
      }, []);
      const modules = state?.modules ?? {};
      const save = (key, value) => {
        const previous = modules[key] !== false;
        setState((current) => ({ ...(current ?? {}), modules: { ...(current?.modules ?? {}), [key]: value } }));
        setNote('保存中…');
        fetch(CONFIG, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ modules: { [key]: value } }),
        })
          .then((response) =>
            response.ok
              ? response.json().then((body) => setState((current) => ({ ...(current ?? {}), ...body })))
              : Promise.reject(new Error(String(response.status))),
          )
          .then(() => setNote('已保存'))
          .catch(() => {
            setState((current) => ({ ...(current ?? {}), modules: { ...(current?.modules ?? {}), [key]: previous } }));
            setNote('保存失败');
          });
      };
      const disabled = !state || state.error === true;
      return h(
        'div',
        { style: { padding: '8px 0', lineHeight: 1.7 } },
        h('p', { style: { margin: '0 0 4px', opacity: 0.75 } }, '按模块开关，默认全开。关掉哪一项，那一项就不再工作。'),
        ...MODULE_ROWS.map(([key, label, hint, timing]) =>
          h(
            'label',
            { key, style: { display: 'block', margin: '6px 0' } },
            h('span', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
              h('input', {
                type: 'checkbox',
                checked: modules[key] !== false,
                disabled,
                onChange: (event) => save(key, event.target.checked),
              }),
              label,
            ),
            h('span', { style: { display: 'block', marginLeft: 24, opacity: 0.7, fontSize: '0.92em' } },
              `${hint}（${timing}）`),
          ),
        ),
        h(PersonaSettings, null),
        h('p', { style: { opacity: 0.75, margin: '10px 0 0' } }, `数据目录：${state?.data_dir ?? '未配置'}`),
        h('p', { style: { opacity: 0.75, margin: '4px 0 0' } },
          `当前生效值来源：${SOURCE_LABEL[state?.modules_source] ?? state?.modules_source ?? '未知'}`),
        // A switch that says "on" while the injector runs on tools-only text is a lie.
        state?.inject && state.inject.level === 'unavailable'
          ? h('p', { style: { margin: '4px 0 0', color: '#c46a00' } },
            `自动注入没跑起来（${state.inject.reason ?? 'unknown'}）`)
          : null,
        note ? h('p', { style: { opacity: 0.75, margin: '4px 0 0' } }, note) : null,
      );
    }

    return {
      inject: ['slots'],
      __test: { resolveMemory, fetchMemory, MemoryPanel, hallWallCount, hallHasNext, hallCells, hallIndex, hallMetrics },
      apply(ctx) {
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: NS }, MemoryPanel),
        );
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: NS, order: 30, label: () => '记忆' }, MemoryIcon),
        );
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register({ name: 'settings.section', id: NS, order: 40, label: () => '记忆系统' }, MemorySettings),
        );
      },
    };
  },
});
