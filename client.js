window.__ModuleLoader__.load({
  id: 'dsh-memsys',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'dsh-memsys';
    const API = '/dsh-memsys/api/summary';
    const CONFIG = '/dsh-memsys/api/config';
    const SEARCH = '/dsh-memsys/api/search';
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

    // Pure CSS/DOM "memory balls on a shelf". No 3D library, no build step,
    // no external resource: gradient + inset shadow + one float keyframe.
    const BALL_CSS = [
'@keyframes msFloat{0%,100%{translate:0 0}50%{translate:0 -.030em}}',
'@keyframes msDevelop{0%{opacity:0;transform:scale(.70);filter:blur(.08em)}45%{opacity:1}100%{opacity:1;transform:scale(1);filter:blur(0)}}',
'@keyframes msWait{0%,100%{opacity:.55}50%{opacity:1}}',
'.ms-panel{padding:16px;line-height:1.7}',
'.ms-counts{margin:0 0 10px;opacity:.85}',
'.ms-shelf{--case-1:#f8f2e8;--case-2:#e6dcc9;--case-edge:rgba(255,255,255,.9);',
'--deck-1:#dcbe93;--deck-2:#c49f70;--deck-3:#9f7c4c;--front-1:#c8a374;--front-2:#8a6a41;',
'--div-1:#c9a77a;--div-2:#7d5f3d;--rim:rgba(255,255,255,.5);--light:rgba(255,246,226,.55);',
'--cushion-edge:rgba(0,0,0,.55);--cushion-rim:rgba(255,255,255,.75);',
'--empty-dark:rgba(46,30,14,.46);--empty-rim:rgba(255,255,255,.62);--empty-glow:rgba(255,232,196,.30);--vignette:rgba(62,42,20,.20);',
'--focus:#2f7bff;margin:0 0 10px}',
'@media (prefers-color-scheme:dark){.ms-shelf{--case-1:#121521;--case-2:#060810;--case-edge:rgba(150,185,255,.16);',
'--deck-1:#2b241c;--deck-2:#1a1510;--deck-3:#0f0c09;--front-1:#332a20;--front-2:#150f0b;',
'--div-1:#2e261d;--div-2:#120e0a;--rim:rgba(150,190,255,.30);--light:rgba(120,170,255,.10);',
'--cushion-edge:rgba(0,0,0,.70);--cushion-rim:var(--ms-rim);--vignette:rgba(0,0,0,.55);',
'--empty-dark:rgba(0,0,0,.50);--empty-rim:rgba(190,220,255,.30);--empty-glow:rgba(150,195,255,.32);',
'--focus:#6ea6ff}}',
'.ms-stage-wrap{position:relative;border-radius:14px;overflow:hidden;box-shadow:0 20px 36px -30px rgba(4,8,18,.6)}',
'.ms-stage{position:relative;height:206px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;',
'perspective:1000px;perspective-origin:50% 36%;',
'background:radial-gradient(90% 70% at 50% 0%,var(--light),transparent 62%),linear-gradient(180deg,var(--case-1),var(--case-2));',
'box-shadow:inset 0 1px 0 var(--case-edge)}',
'.ms-stage::-webkit-scrollbar{display:none}',
'.ms-world{position:relative;width:640px;height:100%;margin:0 auto;transform-style:preserve-3d;',
'transform:rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg));transition:transform .4s ease-out}',
'.ms-light{position:absolute;inset:0;pointer-events:none;background:radial-gradient(70% 60% at 50% -8%,var(--light),transparent 70%)}',
'.ms-vignette{position:absolute;inset:0;pointer-events:none;border-radius:14px;background:radial-gradient(120% 100% at 50% 30%,transparent 38%,var(--vignette,rgba(0,0,0,.25)))}',
'.ms-rack{position:absolute;left:50%;bottom:var(--b,12px);width:640px;height:150px;transform-origin:50% 100%;',
'transform:translateX(-50%) translateZ(var(--z,0px)) scale(var(--k,1));transform-style:preserve-3d}',
'.ms-rack .rk-back{position:absolute;left:7px;right:7px;bottom:56px;height:22px;transform:translateZ(-96px);',
'background:repeating-linear-gradient(0deg,rgba(0,0,0,.28) 0 1px,transparent 1px 6px),linear-gradient(180deg,var(--front-1),var(--front-2));',
'box-shadow:inset 0 0 44px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.08);border-radius:3px}',
'.ms-rack .rk-deck{position:absolute;left:7px;right:7px;bottom:12px;height:100px;transform-origin:50% 100%;',
'transform:rotateX(62deg);transform-style:preserve-3d;border-radius:3px;',
'background:repeating-linear-gradient(90deg,rgba(60,40,20,.10) 0 1px,transparent 1px 9px),',
'linear-gradient(180deg,var(--deck-3),var(--deck-2) 55%,var(--deck-1));',
'box-shadow:inset 0 1px 0 var(--rim),inset 0 0 34px rgba(0,0,0,.45)}',
'.ms-rack .rk-front{position:absolute;left:7px;right:7px;bottom:0;height:12px;border-radius:0 0 4px 4px;',
'background:linear-gradient(180deg,rgba(255,255,255,.55) 0 2px,var(--front-1) 2px,var(--front-2) 100%);',
'box-shadow:0 12px 20px -9px rgba(0,0,0,.65),inset 0 1px 0 var(--rim)}',
'.ms-rack .rk-post{position:absolute;bottom:0;width:12px;height:44px;border-radius:2px;',
'background:linear-gradient(90deg,var(--div-1),var(--div-2));box-shadow:inset 1px 0 0 var(--rim),0 0 14px rgba(0,0,0,.5)}',
'.ms-rack .rk-post-l{left:0}.ms-rack .rk-post-r{right:0}',
'.ms-shelf[data-compact="1"] .ms-world{width:100%;height:100%}',
'.ms-shelf[data-compact="1"] .ms-rack{width:100%}',
'.rk-slots{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:center;align-items:flex-end;gap:0;padding:0 12px;transform-style:preserve-3d}',
'.rk-cell{display:flex;align-items:flex-end;gap:5px;padding:0 7px;transform-style:preserve-3d}',
'.rk-div{position:relative;flex:0 0 auto;width:9px;height:86px;align-self:flex-end;transform:translateZ(-22px);',
'background:linear-gradient(180deg,var(--div-1),var(--div-2));border-radius:2px 2px 0 0;',
'box-shadow:inset 1px 0 0 var(--rim),inset -1px 0 0 rgba(0,0,0,.35),0 6px 10px -4px rgba(0,0,0,.55)}',
'.ms-slot{position:relative;flex:0 0 auto;width:50px;height:var(--ms-size);display:flex;align-items:flex-end;justify-content:center;transform-style:preserve-3d}',
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
'.ms-empty{position:relative;flex:0 0 auto;width:50px;height:var(--ms-size);display:flex;align-items:flex-end;justify-content:center}',
'.ms-empty::before{content:"";width:calc(var(--ms-size) * 1.1);height:calc(var(--ms-size) * 1.1);border-radius:50%;',
'background:radial-gradient(circle at 50% 36%,rgba(255,255,255,.14) 0%,rgba(255,255,255,.02) 34%,var(--empty-dark) 82%,rgba(0,0,0,.10) 100%);',
'box-shadow:0 0 0 1px var(--empty-rim),0 0 0 2px rgba(0,0,0,.16),inset 0 3px 6px rgba(0,0,0,.28),inset 0 -3px 7px var(--empty-glow);',
'animation:msWait 3.4s ease-in-out infinite;animation-delay:var(--ms-delay,0s)}',
'.ms-card{margin-top:10px;padding:12px 14px;border-radius:10px;background:rgba(127,127,127,.08);font-size:.95em}',
'.ms-hint{opacity:.75;margin:6px 0 0}',
'.ms-search{width:100%;box-sizing:border-box;padding:7px 10px;margin:0 0 12px;border-radius:8px;border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.06);color:inherit;font:inherit}',
'.ms-row{display:block;width:100%;text-align:left;padding:8px 10px;margin:0 0 6px;border-radius:8px;cursor:pointer;border:1px solid transparent;background:rgba(127,127,127,.06);color:inherit;font:inherit}',
'.ms-row:hover,.ms-row:focus-visible{border-color:rgba(63,167,255,.55);outline:none}',
'.ms-kind{opacity:.65;margin-right:6px;font-size:.9em}',
'.ms-muted{opacity:.65}',
'@media (prefers-color-scheme:dark){.ms-rack[data-depth="1"] .ms-ball{filter:brightness(.94) saturate(.88)}.ms-rack[data-depth="2"] .ms-ball{filter:brightness(.86) saturate(.76)}}',
'@media (prefers-reduced-motion:reduce){.ms-ball,.ms-ball::after,.ms-empty::before{animation:none !important;transition:none !important}.ms-world{transition:none !important}}',
    ].join('');
    const BALL_SIZES = [44, 40, 36, 32];
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
    // 三排书架：纵深 z / 缩放 k / 距舞台底 b / 球索引区间 / 空槽数
    const BALL_RACKS = [
      { z: 0, k: 1, b: 10, from: 0, to: 8, empty: 2 },
      { z: -150, k: .84, b: 74, from: 8, to: 15, empty: 2 },
      { z: -300, k: .72, b: 128, from: 15, to: 99, empty: 1 },
    ];
    // 窄栏（侧栏 < 480px）：每排 4 颗、整台 100% 宽，不出现横向滚动
    const COMPACT_RACKS = [
      { z: 0, k: 1, b: 8, from: 0, to: 4, empty: 1 },
      { z: -120, k: .90, b: 58, from: 4, to: 8, empty: 0 },
      { z: -240, k: .80, b: 100, from: 8, to: 12, empty: 0 },
    ];
    const COMPACT_BREAKPOINT = 480;
    const EMPTY_SLOTS = 5;
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
    function ballVars(memory, index, depth, compact) {
      const palette = ballPalette(memory.type);
      const baseSize = BALL_SIZES[ballTier(memory, index)];
      const size = compact ? Math.max(36, baseSize) : baseSize;
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
        '--ms-cushion-lip': `rgba(0,0,0,${(0.50 + depth * 0.06).toFixed(2)})`,
        '--ms-gangle': `${gangle.toFixed(0)}deg`,
        '--ms-lx': `${lx.toFixed(1)}%`,
        '--ms-ly': `${ly.toFixed(1)}%`,
        '--ms-rx': `${ballClamp(100 - lx, 54, 78).toFixed(1)}%`,
        '--ms-ry': `${ballClamp(100 - ly + 8, 58, 86).toFixed(1)}%`,
        '--ms-arc': `${arc.toFixed(0)}deg`,
        '--ms-delay': `${index * 130}ms`,
        '--ms-dur': `${(4.9 + (hashValue % 5) * 0.1).toFixed(1)}s`,
      };
    }
    function useCompactShelf() {
      const [compact, setCompact] = React.useState(false);
      const stageRef = React.useRef(null);
      React.useEffect(() => {
        const node = stageRef.current;
        if (!node || typeof node.clientWidth !== 'number') return undefined;
        const apply = (width) => setCompact(width > 0 && width < COMPACT_BREAKPOINT);
        apply(node.clientWidth);
        if (typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver((entries) => {
          const entry = entries && entries[0];
          apply(entry && entry.contentRect ? entry.contentRect.width : node.clientWidth);
        });
        observer.observe(node);
        return () => observer.disconnect();
      }, []);
      return [compact, stageRef];
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
      const [query, setQuery] = React.useState('');
      const [openResultId, setOpenResultId] = React.useState(null);
      const [compact, stageRef] = useCompactShelf();
      if (!state) return h('p', { className: 'ms-panel' }, '读取记忆…');
      if (state.error) return h('p', { className: 'ms-panel' }, '暂时读不到记忆数据。');
      const recent = state.recent ?? [];
      const selected = recent.find((memory) => memory.id === selectedId) ?? null;

      const slotNode = (memory, index, depth) => {
        const palette = ballPalette(memory.type);
        const pressed = selectedId === memory.id;
        return h('span', {
          key: `slot-${memory.id}`,
          className: 'ms-slot',
          role: 'listitem',
          style: ballVars(memory, index, depth, compact),
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
            onClick: () => setSelectedId(pressed ? null : memory.id),
          })),
        h('span', { className: 'ms-lip', 'aria-hidden': true }));
      };

      const emptyNode = (key, depth) => h('span', {
        key,
        className: 'ms-empty',
        'aria-hidden': true,
        style: { '--ms-size': depth === 0 ? '44px' : '38px', '--ms-delay': `${400 + depth * 420}ms` },
      });

      const rackNode = (rack, depth) => {
        const cells = [];
        let cell = [];
        for (let index = rack.from; index < Math.min(rack.to, recent.length); index += 1) {
          cell.push(slotNode(recent[index], index, depth));
          if (cell.length === (compact ? 2 : (depth < 2 ? 3 : 2))) {
            cells.push(h('span', { className: 'rk-cell', key: `cell-${depth}-${cells.length}` }, cell));
            cells.push(h('span', { className: 'rk-div', key: `div-${depth}-${cells.length}`, 'aria-hidden': true }));
            cell = [];
          }
        }
        for (let index = 0; index < rack.empty; index += 1) cell.push(emptyNode(`empty-${depth}-${index}`, depth));
        cells.push(h('span', { className: 'rk-cell', key: `cell-${depth}-last` }, cell));
        return h('div', {
          key: `rack-${depth}`,
          className: 'ms-rack',
          'data-depth': String(depth),
          style: { '--z': `${rack.z}px`, '--k': String(rack.k), '--b': `${rack.b}px` },
        },
        h('div', { className: 'rk-back', 'aria-hidden': true }),
        h('div', { className: 'rk-deck' },
          h('div', { className: 'rk-slots', role: 'list', 'aria-label': `最近的记忆（第 ${depth + 1} 层）` }, cells)),
        h('div', { className: 'rk-front', 'aria-hidden': true }),
        h('div', { className: 'rk-post rk-post-l', 'aria-hidden': true }),
        h('div', { className: 'rk-post rk-post-r', 'aria-hidden': true }));
      };

      // 视差：鼠标在舞台上移动，整台 rotateX(1~4°) / rotateY(±3°)；reduced-motion 下直接不响应
      const onShelfMouseMove = (event) => {
        if (ballReduced()) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const fx = ballClamp((event.clientX - rect.left) / rect.width, 0, 1) - 0.5;
        const fy = ballClamp((event.clientY - rect.top) / rect.height, 0, 1) - 0.5;
        const worldNode = event.currentTarget.querySelector('.ms-world');
        if (!worldNode) return;
        worldNode.style.setProperty('--rx', `${(2.5 + fy * 3).toFixed(2)}deg`);
        worldNode.style.setProperty('--ry', `${(fx * 6).toFixed(2)}deg`);
      };
      const onShelfMouseLeave = (event) => {
        if (ballReduced()) return;
        const worldNode = event.currentTarget.querySelector('.ms-world');
        if (!worldNode) return;
        worldNode.style.setProperty('--rx', '2.5deg');
        worldNode.style.setProperty('--ry', '0deg');
      };

      return h(
        'div',
        { className: 'ms-panel' },
        h('style', { dangerouslySetInnerHTML: { __html: BALL_CSS } }),
        h('h2', { style: { margin: '0 0 8px' } }, '记忆'),
        h('p', { className: 'ms-counts' },
          `记忆 ${state.memories} 条 · 候选 ${state.candidates} 条 · 待确认惦记 ${state.pending_due} 条`),
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
          : h('div', {
            className: 'ms-shelf',
            role: 'region',
            'aria-label': '最近的记忆',
            'data-compact': compact ? '1' : '0',
          },
            h('div', { className: 'ms-stage-wrap' },
              h('div', {
                className: 'ms-stage',
                ref: stageRef,
                onMouseMove: onShelfMouseMove,
                onMouseLeave: onShelfMouseLeave,
              },
              h('div', { className: 'ms-world' },
                (compact ? COMPACT_RACKS : BALL_RACKS).map((rack, depth) => rackNode(rack, depth)))),
              h('div', { className: 'ms-light', 'aria-hidden': true }),
              h('div', { className: 'ms-vignette', 'aria-hidden': true }))),
        query
          ? null
          : h('p', { className: 'ms-hint' },
            recent.length === 0
              ? '还没有记忆。去跟模型说一句「记住：…」吧'
              : '点亮一颗球，看看它装的是什么。'),
        !query && selected
          ? h('div', { className: 'ms-card', key: selected.id },
            Array.from(selected.text).slice(0, CARD_TEXT_LIMIT).join(''))
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
