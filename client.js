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

    // Memory hall, carried over from the confirmed preview: deep walnut racks,
    // white velvet pads, the next rack parked right-and-back, and one wheel
    // notch = one whole rack sliding over. Pure CSS 3D, no library, no assets.
    const BALL_CSS = [
'.ms-hall-scene *{ box-sizing: border-box; }',
'.ms-hall-scene{',
'    --w0: #100904;',
'    --w1: #170e07;',
'    --w2: #21130a;',
'    --w3: #2b1a0d;',
'    --w4: #362110;',
'    --w5: #412714;',
'    --w6: #4a2e17;',
'    --w7: #54361b;',
'    --w8: #5e3d1f;',
'    --w9: #6a4525;',
'    --w10: #79512e;',
'    --w11: #8a623b;',
'  }',
'.ms-hall-scene{',
'    position: relative; width: 900px; height: 620px;',
'    perspective: 2000px;',
'    perspective-origin: 46% 56%;',
'  }',
'.ms-hall-scene .ms-hall-ambient{',
'    position: absolute; inset: 0; pointer-events: none; z-index: 30;',
'    background:',
'      radial-gradient(52% 42% at 40% 12%, rgba(255, 232, 196, .15), transparent 72%),',
'      radial-gradient(66% 58% at 74% 42%, rgba(130, 86, 48, .09), transparent 72%);',
'    mix-blend-mode: screen;',
'  }',
'.ms-hall-scene .ms-hall-vignette{',
'    position: absolute; inset: 0; pointer-events: none; z-index: 40;',
'    background: radial-gradient(122% 105% at 46% 42%, transparent 44%, rgba(0, 0, 0, .62) 100%);',
'  }',
'.ms-hall-scene .ms-hall-floor{',
'    position: absolute; left: 26px; right: 50px; bottom: 0; height: 80px; z-index: 1;',
'    background: radial-gradient(58% 100% at 42% 100%, rgba(0, 0, 0, .68), transparent 70%);',
'    filter: blur(7px);',
'  }',
'.ms-hall-scene .ms-hall-floor-back{',
'    position: absolute; right: 54px; bottom: 26px; width: 320px; height: 64px; z-index: 1;',
'    background: radial-gradient(60% 100% at 62% 100%, rgba(0, 0, 0, .5), transparent 72%);',
'    filter: blur(9px);',
'  }',
'.ms-hall-scene .ms-rack{',
'    position: absolute; left: 26px; top: 24px; width: 620px; height: 556px;',
'    transform-style: preserve-3d;',
'  }',
'.ms-hall-scene .ms-rack::after{',
'    content: ""; position: absolute; inset: 0; z-index: 21; pointer-events: none;',
'    border-radius: 3px;',
'    background:',
'      repeating-linear-gradient(91deg, rgba(255, 226, 186, .022) 0 1px, transparent 1px 6px),',
'      repeating-linear-gradient(89deg, rgba(0, 0, 0, .10) 0 1px, transparent 1px 11px);',
'    mix-blend-mode: overlay;',
'    opacity: .8;',
'  }',
'.ms-hall-scene .ms-hall-back{',
'    position: absolute; left: 38px; right: 38px; top: 30px; bottom: 30px;',
'    transform: translateZ(-30px);',
'    background:',
'      radial-gradient(90% 70% at 30% 14%, rgba(255, 220, 176, .09), transparent 62%),',
'      repeating-linear-gradient(90deg, rgba(0, 0, 0, .34) 0 2px, rgba(255, 255, 255, .018) 2px 3px, transparent 3px 46px),',
'      linear-gradient(180deg, var(--w2) 0%, var(--w1) 54%, #0d0703 100%);',
'    box-shadow:',
'      inset 0 0 110px rgba(0, 0, 0, .88),',
'      inset 0 0 0 1px rgba(0, 0, 0, .5);',
'  }',
'.ms-hall-scene .ms-hall-post{',
'    position: absolute; top: 0; bottom: 0; width: 38px; z-index: 12;',
'    transform: translateZ(16px);',
'    border-radius: 2px;',
'    background:',
'      repeating-linear-gradient(90deg, rgba(0, 0, 0, .14) 0 1px, rgba(255, 255, 255, .03) 1px 2px, transparent 2px 7px),',
'      linear-gradient(90deg, var(--w1) 0%, var(--w3) 8%, var(--w5) 24%, var(--w7) 44%, var(--w6) 60%, var(--w4) 78%, var(--w2) 92%, var(--w0) 100%);',
'    box-shadow:',
'      inset 0 1px 0 rgba(255, 232, 194, .22),',
'      inset 0 0 0 1px rgba(255, 220, 176, .06),',
'      0 14px 26px -10px rgba(0, 0, 0, .8);',
'  }',
'.ms-hall-scene .ms-hall-post::before{',
'    content: ""; position: absolute; inset: 0; border-radius: 2px;',
'    background: linear-gradient(90deg, rgba(255, 234, 198, .26) 0 1px, rgba(255, 234, 198, .05) 2px, transparent 5px);',
'  }',
'.ms-hall-scene .ms-hall-post::after{',
'    content: ""; position: absolute; top: 0; bottom: 0; width: 11px;',
'    background: linear-gradient(90deg, rgba(0, 0, 0, .62), transparent);',
'    border-radius: 2px;',
'  }',
'.ms-hall-scene .ms-hall-post-l{ left: 0; }',
'.ms-hall-scene .ms-hall-post-r{ right: 0; }',
'.ms-hall-scene .ms-hall-post-r::after{ left: auto; right: 0; background: linear-gradient(270deg, rgba(0, 0, 0, .62), transparent); }',
'.ms-hall-scene .ms-hall-post-r::before{ background: linear-gradient(270deg, rgba(255, 234, 198, .20) 0 1px, transparent 5px); }',
'.ms-hall-scene .ms-hall-rail{',
'    position: absolute; left: 0; right: 0; height: 30px; z-index: 13;',
'    transform: translateZ(14px);',
'    background:',
'      repeating-linear-gradient(90deg, rgba(0, 0, 0, .12) 0 1px, rgba(255, 255, 255, .03) 1px 2px, transparent 2px 6px),',
'      linear-gradient(180deg, var(--w10) 0%, var(--w8) 12%, var(--w6) 40%, var(--w4) 72%, var(--w2) 100%);',
'    box-shadow:',
'      inset 0 2px 0 rgba(255, 240, 210, .34),',
'      inset 0 -4px 5px rgba(0, 0, 0, .48),',
'      0 10px 18px -7px rgba(0, 0, 0, .7);',
'  }',
'.ms-hall-scene .ms-hall-rail::after{',
'    content: ""; position: absolute; left: 0; right: 0; bottom: -9px; height: 9px;',
'    background: linear-gradient(180deg, rgba(0, 0, 0, .6), transparent);',
'  }',
'.ms-hall-scene .ms-hall-rail-top{ top: 0; border-radius: 3px 3px 0 0; }',
'.ms-hall-scene .ms-hall-rail-bottom{ bottom: 0; border-radius: 0 0 3px 3px; }',
'.ms-hall-scene .ms-hall-rail-bottom::after{ top: -9px; bottom: auto; background: linear-gradient(0deg, rgba(0, 0, 0, .6), transparent); }',
'.ms-hall-scene .ms-hall-cap{',
'    position: absolute; left: -9px; right: -9px; top: -9px; height: 13px; z-index: 16;',
'    transform: translateZ(22px);',
'    border-radius: 3px;',
'    background:',
'      repeating-linear-gradient(90deg, rgba(0, 0, 0, .12) 0 1px, rgba(255, 255, 255, .03) 1px 2px, transparent 2px 6px),',
'      linear-gradient(180deg, var(--w11) 0%, var(--w9) 36%, var(--w6) 100%);',
'    box-shadow:',
'      inset 0 2px 0 rgba(255, 246, 220, .38),',
'      0 4px 8px -3px rgba(0, 0, 0, .65);',
'  }',
'.ms-hall-scene .ms-hall-cap::after{',
'    content: ""; position: absolute; left: 0; right: 0; bottom: -6px; height: 6px;',
'    background: linear-gradient(180deg, rgba(0, 0, 0, .55), transparent);',
'  }',
'.ms-hall-scene .ms-hall-shelf{',
'    position: absolute; left: 38px; right: 38px; height: 26px; z-index: 6;',
'    transform: translateZ(18px);',
'    top: calc(17px + var(--r) * 99.2px);',
'    border-radius: 1px;',
'    background:',
'      repeating-linear-gradient(90deg, rgba(72, 44, 20, .30) 0 1px, rgba(255, 236, 200, .05) 1px 2px, transparent 2px 4px),',
'      linear-gradient(180deg, var(--w11) 0%, var(--w10) 18%, var(--w8) 46%, var(--w5) 76%, var(--w3) 100%);',
'    box-shadow:',
'      inset 0 1px 0 rgba(255, 246, 224, .58),',
'      inset 0 -2px 0 rgba(0, 0, 0, .38),',
'      0 8px 10px -4px rgba(0, 0, 0, .6);',
'  }',
'.ms-hall-scene .ms-hall-shelf::before{',
'    content: ""; position: absolute; left: 0; right: 0; top: 0; height: 2px;',
'    background: linear-gradient(90deg, rgba(255, 246, 224, .7), rgba(255, 246, 224, .22) 30%, rgba(255, 246, 224, .5));',
'  }',
'.ms-hall-scene .ms-hall-shelf::after{',
'    content: ""; position: absolute; left: 0; right: 0; bottom: -8px; height: 8px;',
'    background: linear-gradient(180deg, rgba(0, 0, 0, .66), transparent);',
'  }',
'.ms-hall-scene .ms-hall-rows{',
'    position: absolute; left: 38px; right: 38px; top: 30px; bottom: 30px;',
'    display: flex; flex-direction: column; z-index: 8;',
'    transform-style: preserve-3d;',
'  }',
'.ms-hall-scene .ms-hall-row{',
'    position: relative; flex: 1;',
'    display: flex; align-items: flex-end; justify-content: space-around;',
'    padding: 0 6px;',
'  }',
'.ms-hall-scene .ms-slot{ position: relative; width: 104px; height: 100%; }',
'.ms-hall-scene .ms-slot::before{',
'    content: ""; position: absolute; left: 50%; bottom: 18px; width: 64px; height: 18px;',
'    transform: translateX(-50%);',
'    background: radial-gradient(closest-side, rgba(70, 52, 32, .46), rgba(70, 52, 32, .13) 64%, transparent 100%);',
'    filter: blur(2.5px);',
'    z-index: 1;',
'  }',
'.ms-hall-scene .ms-cushion{',
'    position: absolute; left: 50%; bottom: 14px; width: 96px; height: 22px;',
'    transform: translateX(-50%);',
'    border-radius: 50%;',
'    background:',
'      radial-gradient(closest-side at 50% 62%, rgba(132, 110, 82, .30), rgba(132, 110, 82, .10) 46%, transparent 64%),',
'      radial-gradient(closest-side at 46% 34%, #f9f2e6 0%, #f1e7d7 34%, #e3d6c1 64%, #ccba9f 86%, #b3a088 100%),',
'      radial-gradient(closest-side at 26% 62%, rgba(196, 174, 144, .22), transparent 58%),',
'      radial-gradient(closest-side at 74% 60%, rgba(196, 174, 144, .20), transparent 58%),',
'      repeating-conic-gradient(from 96deg at 50% 50%, rgba(255, 255, 255, .05) 0deg 3deg, rgba(150, 130, 102, .05) 3deg 6deg);',
'    box-shadow:',
'      inset 0 -3px 7px rgba(110, 90, 66, .18),',
'      0 3px 8px -4px rgba(24, 15, 7, .40),',
'      0 0 9px rgba(255, 246, 228, .08);',
'    filter: blur(2.8px);',
'    z-index: 2;',
'  }',
'.ms-hall-scene .ms-cushion::before{',
'    content: ""; position: absolute; inset: 10% 8%;',
'    border-radius: 50%;',
'    background:',
'      radial-gradient(closest-side at 34% 32%, rgba(255, 255, 255, .38), transparent 58%),',
'      radial-gradient(closest-side at 70% 70%, rgba(150, 130, 102, .16), transparent 66%),',
'      radial-gradient(closest-side at 50% 90%, rgba(136, 116, 90, .16), transparent 70%);',
'    filter: blur(3.6px);',
'  }',
'.ms-hall-scene .ms-cushion::after{',
'    content: ""; position: absolute; inset: -6px;',
'    border-radius: 50%;',
'    transform: rotate(-4deg) scale(1.04);',
'    background: radial-gradient(closest-side, rgba(248, 242, 230, .45) 0%, rgba(248, 242, 230, .30) 60%, rgba(248, 242, 230, .05) 86%, transparent 96%);',
'    filter: blur(6px);',
'    opacity: .65;',
'  }',
'.ms-hall-scene .ms-cushion-front{',
'    position: absolute; left: 50%; bottom: 14px; width: 96px; height: 22px;',
'    transform: translateX(-50%);',
'    border-radius: 50%;',
'    clip-path: inset(42% 0 0 0);',
'    -webkit-mask: linear-gradient(180deg, transparent 32%, rgba(0, 0, 0, .30) 48%, #000 68%, #000 100%);',
'    mask: linear-gradient(180deg, transparent 32%, rgba(0, 0, 0, .30) 48%, #000 68%, #000 100%);',
'    background:',
'      radial-gradient(closest-side at 50% 26%, rgba(154, 132, 102, .55) 0%, rgba(196, 178, 150, .62) 34%, rgba(230, 219, 201, .85) 62%, rgba(240, 232, 218, .9) 86%, rgba(206, 190, 166, .82) 100%);',
'    box-shadow: inset 0 -2px 4px rgba(110, 90, 66, .18);',
'    filter: blur(3.4px);',
'    z-index: 4;',
'  }',
'.ms-hall-scene .ms-slot::after{',
'    content: ""; position: absolute; left: 50%; bottom: 13px; width: 74px; height: 24px;',
'    transform: translateX(-50%);',
'    border-radius: 50%;',
'    background: radial-gradient(closest-side, transparent 34%, rgba(92, 70, 46, .40) 50%, rgba(92, 70, 46, .16) 68%, transparent 86%);',
'    filter: blur(2.5px);',
'    z-index: 5;',
'  }',
'.ms-hall-scene .ms-ball{',
'    position: absolute; left: 50%; bottom: 12px; width: 64px; height: 64px;',
'    transform: translateX(-50%);',
'    border-radius: 50%;',
'    z-index: 3;',
'    background:',
'      radial-gradient(circle at 34% 24%, rgba(255, 255, 255, .98) 0, rgba(255, 255, 255, .78) 4%, rgba(255, 255, 255, .26) 12%, rgba(255, 255, 255, 0) 23%),',
'      radial-gradient(circle at 50% 46%, transparent 45%, var(--edge) 84%, var(--edge) 100%),',
'      linear-gradient(142deg, var(--hi) 0%, var(--core) 30%, var(--mid) 66%, var(--lo) 100%),',
'      radial-gradient(circle at 50% 118%, rgba(255, 255, 255, .46), transparent 46%);',
'    box-shadow:',
'      inset 0 0 0 1.5px rgba(255, 255, 255, .28),',
'      inset 5px 7px 15px rgba(255, 255, 255, .34),',
'      inset -6px -9px 18px var(--dark),',
'      inset -2px -3px 6px rgba(255, 255, 255, .38),',
'      0 0 20px 2px var(--glow),',
'      0 6px 14px -6px rgba(0, 0, 0, .55);',
'  }',
'.ms-hall-scene .ms-ball::before{',
'    content: ""; position: absolute; inset: 0; border-radius: 50%;',
'    background: conic-gradient(from 208deg at 50% 50%,',
'      rgba(255, 255, 255, 0) 0deg, rgba(255, 255, 255, .16) 10deg,',
'      rgba(255, 255, 255, .9) 28deg, #fff 38deg, rgba(255, 255, 255, .58) 54deg,',
'      rgba(255, 255, 255, 0) 74deg);',
'    -webkit-mask: radial-gradient(closest-side at 50% 50%, transparent 68%, #000 80%, #000 92%, transparent 100%);',
'    mask: radial-gradient(closest-side at 50% 50%, transparent 68%, #000 80%, #000 92%, transparent 100%);',
'    filter: blur(.4px);',
'  }',
'.ms-hall-scene .ms-ball::after{',
'    content: ""; position: absolute; left: 12%; right: 12%; bottom: -8px; height: 14px;',
'    border-radius: 50%;',
'    background: radial-gradient(closest-side, rgba(84, 64, 42, .40), rgba(84, 64, 42, .14) 62%, transparent 84%);',
'    filter: blur(2px);',
'  }',
'.ms-hall-scene .ms-hall-plinth{',
'    position: absolute; left: 12px; top: 582px; width: 634px; height: 34px; z-index: 14;',
'    transform: translateZ(22px);',
'    background:',
'      repeating-linear-gradient(90deg, rgba(0, 0, 0, .12) 0 1px, transparent 1px 8px),',
'      linear-gradient(180deg, var(--w11) 0%, var(--w9) 14%, var(--w7) 38%, var(--w5) 66%, var(--w3) 88%, var(--w1) 100%);',
'    box-shadow:',
'      inset 0 2px 0 rgba(255, 242, 210, .38),',
'      inset 0 -4px 6px rgba(0, 0, 0, .5),',
'      0 16px 26px -12px rgba(0, 0, 0, .8);',
'    border-radius: 3px;',
'  }',
'.ms-hall-scene .ms-hall-plinth::before{',
'    content: ""; position: absolute; left: 0; right: 0; top: 0; height: 5px;',
'    background: linear-gradient(180deg, rgba(255, 240, 210, .55), rgba(255, 240, 210, .10));',
'  }',
'.ms-hall-scene .ms-hall-plinth::after{',
'    content: ""; position: absolute; left: 1%; right: 1%; bottom: -5px; height: 5px;',
'    background: linear-gradient(180deg, rgba(0, 0, 0, .6), transparent);',
'  }',
'.ms-hall-scene .ms-hall-seam{',
'    position: absolute; left: 643px; top: 28px; width: 9px; height: 548px; z-index: 20;',
'    pointer-events: none;',
'    background: linear-gradient(90deg, rgba(0, 0, 0, .55) 0%, rgba(0, 0, 0, .20) 48%, rgba(0, 0, 0, 0) 100%);',
'    -webkit-mask: linear-gradient(180deg, transparent 0%, #000 8%, #000 92%, transparent 100%);',
'    mask: linear-gradient(180deg, transparent 0%, #000 8%, #000 92%, transparent 100%);',
'  }',
'.ms-hall-scene .ms-hall-plinth-back{',
'    position: absolute; left: 620px; top: 554px; width: 176px; height: 24px; z-index: 12;',
'    border-radius: 2px;',
'    background:',
'      repeating-linear-gradient(90deg, rgba(0, 0, 0, .18) 0 1px, transparent 1px 7px),',
'      linear-gradient(180deg, #573a21 0%, #452c18 20%, #33200f 54%, #241408 86%, #150c05 100%);',
'    box-shadow:',
'      inset 0 1px 0 rgba(255, 226, 186, .14),',
'      inset 0 -3px 5px rgba(0, 0, 0, .55),',
'      0 8px 14px -6px rgba(0, 0, 0, .9);',
'    -webkit-mask: linear-gradient(90deg, transparent 0 38%, rgba(0, 0, 0, .35) 50%, #000 66%, #000 100%);',
'    mask: linear-gradient(90deg, transparent 0 38%, rgba(0, 0, 0, .35) 50%, #000 66%, #000 100%);',
'  }',
'.ms-hall-scene .ms-hall-plinth-back::after{',
'    content: ""; position: absolute; right: -3px; top: 0; bottom: 0; width: 3px;',
'    background: linear-gradient(90deg, rgba(0, 0, 0, .45), transparent);',
'  }',
'.ms-hall-scene .ms-hall-shadow{',
'    position: absolute; left: 26px; top: 24px; width: 620px; height: 556px; z-index: 2;',
'    border-radius: 4px;',
'    box-shadow: 30px 34px 70px -22px rgba(0, 0, 0, .9);',
'    pointer-events: none;',
'  }',
'.ms-panel{padding:16px;line-height:1.7}',
'.ms-counts{margin:0 0 10px;opacity:.85}',
'.ms-link{align-self:flex-start;margin:6px 0 0;padding:2px 8px;border-radius:6px;border:1px solid rgba(127,127,127,.4);background:transparent;color:inherit;font:inherit;cursor:pointer}',
'.ms-card{margin-top:10px;padding:12px 14px;border-radius:10px;background:rgba(127,127,127,.08);font-size:.95em}',
'.ms-hint{opacity:.75;margin:6px 0 0}',
'.ms-search{width:100%;box-sizing:border-box;padding:7px 10px;margin:0 0 12px;border-radius:8px;border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.06);color:inherit;font:inherit}',
'.ms-row{display:block;width:100%;text-align:left;padding:8px 10px;margin:0 0 6px;border-radius:8px;cursor:pointer;border:1px solid transparent;background:rgba(127,127,127,.06);color:inherit;font:inherit}',
'.ms-row:hover,.ms-row:focus-visible{border-color:rgba(63,167,255,.55);outline:none}',
'.ms-kind{opacity:.65;margin-right:6px;font-size:.9em}',
'.ms-muted{opacity:.65}',
      '.ms-search{height:38px}',
      '.ms-search-spacer{height:38px;margin:0 0 12px}',
      '.ms-review .ms-card-text{margin:0}',
      '.ms-review .ms-actions{margin-top:8px}',
      '.ms-tabs{display:flex;gap:6px;margin:0 0 10px;border-bottom:1px solid rgba(127,127,127,.28)}',
      '.ms-tab{padding:6px 12px;border:0;border-bottom:2px solid transparent;background:transparent;color:inherit;font:inherit;cursor:pointer;opacity:.7}',
      '.ms-tab[aria-selected="true"]{opacity:1;border-bottom-color:var(--focus,#4a9eff)}',
      '.ms-item{padding:10px 12px;margin:0 0 8px;border-radius:10px;background:rgba(127,127,127,.07)}',
      '.ms-item-head{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}',
      '.ms-item-text{margin:4px 0 0;white-space:pre-wrap}',
      '.ms-item-meta{opacity:.65;font-size:.88em}',
      '.ms-actions{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}',
      '.ms-btn{padding:5px 12px;border-radius:8px;border:1px solid rgba(127,127,127,.45);background:rgba(127,127,127,.10);color:inherit;font:inherit;cursor:pointer}',
      '.ms-btn:disabled{opacity:.5;cursor:not-allowed}',
      '.ms-err{color:#c43d3d;margin:6px 0 0}',
'.ms-hall-stage{position:relative;overflow:hidden;border-radius:14px;background:radial-gradient(120% 100% at 48% 22%,#2b2118 0%,#17110c 46%,#080605 100%);box-shadow:inset 0 1px 0 rgba(150,185,255,.10)}',
'.ms-hall-view{position:absolute;left:0;top:0;width:900px;height:620px;transform-origin:0 0}',
'.ms-hall-nav{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 2px 0;font-size:.92em}',
'.ms-hall-btn{padding:4px 10px;border-radius:999px;border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.08);color:inherit;font:inherit;cursor:pointer}',
'.ms-hall-btn:disabled{opacity:.35;cursor:default}',
'.ms-hall-btn:focus-visible{outline:2px solid #6ea6ff;outline-offset:2px}',
'.ms-hall-pos{opacity:.75}',
'.ms-rack{transition:transform .55s cubic-bezier(.22,.72,.2,1),filter .45s ease,opacity .3s ease}',
'.ms-rack[data-rel="0"]{transform:none;filter:brightness(1) saturate(1) blur(0);z-index:3}',
'.ms-rack[data-rel="1"]{transform:translateX(170px) translateZ(-260px);filter:brightness(.72) saturate(.9) blur(.6px);z-index:2}',
'.ms-rack[data-rel="-1"]{transform:translateX(-170px) translateZ(-260px);filter:brightness(.55) saturate(.85) blur(1px);z-index:1;opacity:0;visibility:hidden;transition:transform .55s cubic-bezier(.22,.72,.2,1),filter .45s ease,opacity .3s ease .18s,visibility 0s .55s}',
'.ms-rack .ms-ball{border:0;padding:0;font:inherit;appearance:none;-webkit-appearance:none;cursor:pointer}',
'.ms-rack .ms-ball:focus-visible{outline:2px solid #6ea6ff;outline-offset:3px}',
'.ms-rack .ms-slot{cursor:pointer}',
'.ms-rack .ms-slot.is-empty{cursor:default;opacity:.5}',
'.ms-rack .ms-slot.is-empty .ms-cushion{filter:brightness(.5) blur(1px)}',
'@media (prefers-reduced-motion:reduce){.ms-rack{transition:none !important}.ms-rack .ms-ball{transition:none !important}}',

    ].join('');

    const HALL_SIZE = 25;              // 5 rows x 5 columns = one rack
    const HALL_COLUMNS = 5;
    const WHEEL_STEP = 24;             // a wheel gesture must travel this far to count
    const WHEEL_LOCK_MS = 560;         // one rack per gesture: lock while it slides
    const HALL_DESIGN_W = 900;         // the preview is drawn in a 900x620 space
    const HALL_DESIGN_H = 620;
    const HALL_VISIBLE_W = 780;        // left 780px of that space carries both racks
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
    // Three tiers, deliberately separate:
    //   ball/aria-label = 120 codepoints (a directory entry, not the text)
    //   card preview    = 300 codepoints with an expand toggle
    //   expanded card   = the whole text, no second truncation
    const SUMMARY_TEXT_LIMIT = 120;
    const CARD_PREVIEW_LIMIT = 300;

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
    function ballDayLabel(stamp) {
      const value = Date.parse(stamp);
      if (!isFinite(value)) return '未知时间';
      const date = new Date(value);
      return `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, '0')}`;
    }
    /** Palette only: the preview fixes every ball at 64px and one light rig. */
    function ballStyle(memory) {
      const palette = ballPalette(memory.type);
      return {
        '--hi': palette.hi,
        '--core': palette.core,
        '--mid': palette.mid,
        '--lo': palette.lo,
        '--dark': ballRgba(palette.lo, .62),
        '--edge': ballRgba(palette.lo, .48),
        '--glow': palette.glow,
      };
    }

    // The whole scene is drawn at the preview's 900x620 coordinates and scaled
    // down as one piece, so panel width never changes the composition.
    function hallMetrics(width) {
      const stageWidth = width > 0 ? width : 340;
      const scale = Math.max(0.3, Math.min(1, stageWidth / HALL_VISIBLE_W));
      const stageHeight = Math.round(HALL_DESIGN_H * scale);
      return { stageWidth, scale, stageHeight };
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
          const body = Array.from(String(item.text ?? '')).slice(0, SUMMARY_TEXT_LIMIT).join('');
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

    const TABS = [
      { key: 'memory', label: '记忆' },
      { key: 'candidate', label: '候选' },
      { key: 'pending', label: '惦记' },
      { key: 'dream', label: '梦' },
    ];
    const REVIEW = '/dsh-memsys/api/review';
    const REVIEW_EMPTY = {
      candidate: '还没有待审候选。',
      pending: '还没有惦记。',
      dream: '还没有梦。',
    };

    const REVIEW_TABS = {
      candidate: { title: '候选', empty: '还没有待审候选。', source: '来源：模型提取' },
      pending: { title: '惦记', empty: '还没有惦记。', source: '来源：主人原话' },
      dream: { title: '梦', empty: '还没有梦。', source: '来源：梦库' },
    };

    function ReviewList({ kind }) {
      const meta = REVIEW_TABS[kind] ?? REVIEW_TABS.candidate;
      const [items, setItems] = React.useState(null);
      const [summary, setSummary] = React.useState(null);
      const [failed, setFailed] = React.useState('');
      const [busy, setBusy] = React.useState('');
      const [note, setNote] = React.useState({});

      const load = () => {
        fetch(REVIEW + '?kind=' + kind)
          .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
          .then((data) => { setItems(Array.isArray(data?.items) ? data.items : []); setFailed(''); })
          .catch(() => { setFailed('这一页暂时读不出来'); setItems([]); });
        // Same counts vocabulary as the memory tab; failing here must not break the list.
        fetch(API)
          .then((response) => (response.ok ? response.json() : null))
          .then((data) => setSummary(data ?? null))
          .catch(() => setSummary(null));
      };
      React.useEffect(load, [kind]);

      const act = (item, action) => {
        setBusy(item.id + action);
        setNote((current) => ({ ...current, [item.id]: '' }));
        const payload = kind === 'pending'
          ? { kind, id: item.id, action, revision: item.revision }
          : { kind, id: item.id, action, baseRevision: item.base_revision };
        fetch(REVIEW, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
          .then((response) => response.json().catch(() => ({})).then((body) => ({ response, body })))
          .then(({ response, body }) => {
            const result = body?.result ?? {};
            const ok = body?.ok === true && response.ok;
            if (!ok) {
              const reason = result.message || result.reason || result.code || body?.error || String(response.status);
              setNote((current) => ({ ...current, [item.id]: '没成功：' + reason }));
              return;
            }
            setNote((current) => ({ ...current, [item.id]: action === 'promote' ? '已批准' : '已处理' }));
            load();
          })
          .catch((error) => setNote((current) => ({ ...current, [item.id]: '没成功：' + String(error?.message ?? error) })))
          .then(() => setBusy(''));
      };

      const shown = items ?? [];
      const now = Date.now();
      const countsText = kind === 'candidate'
        ? `候选 ${summary?.candidates ?? shown.length} 条 · 待审 ${shown.length} 条`
        : kind === 'pending'
          ? `待确认 ${summary?.pending_due ?? shown.length} 条 · 已到期 ${shown.filter((item) => item.due_at && Date.parse(item.due_at) <= now).length} 条`
          : `梦境 ${shown.length} 条`;

      const body = failed
        ? h('p', { className: 'ms-hint' }, failed)
        : items === null
          ? h('p', { className: 'ms-hint' }, '读取中…')
          : shown.length === 0
            ? h('p', { className: 'ms-hint' }, meta.empty)
            : h('div', { role: 'list', 'aria-label': meta.title },
              shown.map((item) => h('div', { key: item.id, className: 'ms-card ms-item', role: 'listitem' },
                h('p', { className: 'ms-card-text' },
                  Array.from(String(item.text ?? '')).slice(0, 160).join('')),
                h('p', { className: 'ms-muted', style: { margin: '4px 0 0' } },
                  [item.type ?? item.due_state ?? item.status ?? kind, item.recorded_at ?? item.due_at ?? '', meta.source]
                    .filter(Boolean).join(' · ')),
                kind === 'candidate'
                  ? h('div', { className: 'ms-actions' },
                    h('button', { type: 'button', className: 'ms-link', disabled: busy === item.id + 'promote', onClick: () => act(item, 'promote') }, '批准'),
                    h('button', { type: 'button', className: 'ms-link', disabled: busy === item.id + 'reject', onClick: () => act(item, 'reject') }, '驳回'))
                  : kind === 'pending'
                    ? h('div', { className: 'ms-actions' },
                      h('button', { type: 'button', className: 'ms-link', disabled: busy === item.id + 'confirm' || !item.revision, onClick: () => act(item, 'confirm') }, '确认已做'),
                      h('button', { type: 'button', className: 'ms-link', disabled: busy === item.id + 'shelve' || !item.revision, onClick: () => act(item, 'shelve') }, '搁置'))
                    : null,
                note[item.id] ? h('p', { className: 'ms-err' }, note[item.id]) : null)));

      // Same skeleton as the memory tab: h2 + ms-counts + a search-height spacer,
      // so switching tabs only swaps content and never shifts the layout.
      return h('div', { className: 'ms-review ms-panel' },
        h('h2', { style: { margin: '0 0 8px' } }, meta.title),
        h('p', { className: 'ms-counts' }, countsText),
        h('div', { className: 'ms-search-spacer', 'aria-hidden': true }),
        body);
    }

    function MemoryPanel() {
      const [tab, setTab] = React.useState('memory');
      return h('div', { className: 'ms-panel' },
        h('div', { className: 'ms-tabs', role: 'tablist' },
          TABS.map(({ key, label }) => h('button', {
            key,
            type: 'button',
            role: 'tab',
            className: 'ms-tab',
            'aria-selected': tab === key,
            onClick: () => setTab(key),
          }, label))),
        tab === 'memory' ? h(MemoryShelf, null) : h(ReviewList, { kind: tab }));
    }

    function MemoryShelf() {
      const [state] = useSummary();
      const [selectedId, setSelectedId] = React.useState(null);
      const [detail, setDetail] = React.useState(null);
      const [cardExpanded, setCardExpanded] = React.useState(false);
      const [query, setQuery] = React.useState('');
      const [openResultId, setOpenResultId] = React.useState(null);
      const [stageWidth, stageNodeRef, measureStage] = useHallLayout();
      const [pages, setPages] = React.useState({});
      const [wall, setWall] = React.useState(0);
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
      wallRef.current = wall;
      totalRef.current = total;

      React.useEffect(() => {
        mounted.current = true;
        return () => {
          mounted.current = false;
          if (moveTimer.current) clearTimeout(moveTimer.current);
        };
      }, []);

      // The front rack plus the next (older) rack parked right-and-back; deeper
      // racks are only fetched when the wheel brings them closer.
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
          pendingRef.current = 0;
          return;
        }
        restRef.current = false;
        if (moveTimer.current) clearTimeout(moveTimer.current);
        moveTimer.current = setTimeout(finishMove, WHEEL_LOCK_MS);
      };
      stepRef.current = step;

      // React attaches wheel listeners passively, so preventDefault there is a
      // no-op: use a native non-passive listener. One gesture = one whole rack.
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

      const openMemory = (memory) => {
        setSelectedId(memory.id);
        setCardExpanded(false);
        setDetail({ id: memory.id, status: 'loading', text: null, type: memory.type, recorded_at: memory.recorded_at });
        // Always re-read the正文 by id: the page carries a truncated copy, and a
        // silent local-only render is exactly what made "点球" look dead.
        fetchMemory(memory.id)
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

      const slotNode = (memory, index, pageItems) => {
        const palette = ballPalette(memory.type);
        const pressed = selectedId === memory.id;
        return h('span', {
          key: `slot-${memory.id}`,
          className: 'ms-slot',
          role: 'listitem',
          // Decoration layers are pointer-events:none, so a click lands here.
          // The handler lives on the slot: the ball must not toggle twice.
          onClick: () => {
            if (pressed) {
              setSelectedId(null);
              setDetail(null);
              return;
            }
            openMemory(memory);
          },
        },
        h('span', { className: 'ms-cushion', 'aria-hidden': true }),
        h('button', {
          type: 'button',
          className: 'ms-ball',
          style: ballStyle(memory),
          'aria-pressed': pressed,
          'aria-label': `${memory.text}（${palette.label} · ${ballDayLabel(memory.recorded_at)}）`,
          title: `${memory.text} · ${palette.label} · ${ballDayLabel(memory.recorded_at)}`,
          'data-type': memory.type,
        }),
        h('span', { className: 'ms-cushion-front', 'aria-hidden': true }));
      };

      const emptyNode = (key) => h('span', {
        key,
        className: 'ms-slot is-empty',
        'aria-hidden': true,
      },
      h('span', { className: 'ms-cushion', 'aria-hidden': true }),
      h('span', { className: 'ms-cushion-front', 'aria-hidden': true }));

      const rackNode = (pageIndex, relative) => {
        const items = pages[pageIndex] ?? null;
        const cells = hallCells(items);
        const rows = [];
        for (let row = 0; row < HALL_COLUMNS; row += 1) {
          const seats = [];
          for (let column = 0; column < HALL_COLUMNS; column += 1) {
            const cell = row * HALL_COLUMNS + column;
            const memory = cells[cell];
            seats.push(memory
              ? slotNode(memory, hallIndex(pageIndex, cell), items)
              : emptyNode(`empty-${pageIndex}-${cell}`));
          }
          rows.push(h('div', { key: `row-${row}`, className: 'ms-hall-row' }, seats));
        }
        return h('div', {
          key: `rack-${pageIndex}`,
          className: 'ms-rack',
          'data-rel': String(relative),
          role: 'group',
          'aria-label': `第 ${pageIndex + 1} 面记忆架`,
          'aria-hidden': relative === -1 ? 'true' : undefined,
        },
        h('div', { className: 'ms-hall-back', 'aria-hidden': true }),
        [1, 2, 3, 4].map((row) => h('div', {
          key: `shelf-${row}`,
          className: 'ms-hall-shelf',
          style: { '--r': row },
          'aria-hidden': true,
        })),
        h('div', {
          className: 'ms-hall-rows',
          role: 'list',
          'aria-label': `第 ${pageIndex + 1} 面，共 ${items ? items.length : 0} 条`,
        }, rows),
        h('div', { className: 'ms-hall-post ms-hall-post-l', 'aria-hidden': true }),
        h('div', { className: 'ms-hall-post ms-hall-post-r', 'aria-hidden': true }),
        h('div', { className: 'ms-hall-rail ms-hall-rail-top', 'aria-hidden': true }),
        h('div', { className: 'ms-hall-rail ms-hall-rail-bottom', 'aria-hidden': true }),
        h('div', { className: 'ms-hall-cap', 'aria-hidden': true }));
      };

      const racks = [];
      if (wall > 0 && pages[wall - 1]) racks.push(rackNode(wall - 1, -1));
      if (hallHasNext(wall, total)) racks.push(rackNode(wall + 1, 1));
      racks.push(rackNode(wall, 0));

      const hall = h('div', { className: 'ms-hall', role: 'region', 'aria-label': '记忆走廊' },
        h('div', {
          className: 'ms-hall-stage',
          ref: measureStage,
          style: { height: `${metrics.stageHeight}px` },
        },
        h('div', {
          className: 'ms-hall-view',
          style: { transform: `scale(${metrics.scale})` },
        },
        h('div', { className: 'ms-hall-scene' },
          h('div', { className: 'ms-hall-floor', 'aria-hidden': true }),
          h('div', { className: 'ms-hall-floor-back', 'aria-hidden': true }),
          racks,
          h('div', { className: 'ms-hall-shadow', 'aria-hidden': true }),
          h('div', { className: 'ms-hall-plinth', 'aria-hidden': true }),
          h('div', { className: 'ms-hall-plinth-back', 'aria-hidden': true }),
          h('div', { className: 'ms-hall-seam', 'aria-hidden': true }),
          h('div', { className: 'ms-hall-ambient', 'aria-hidden': true }),
          h('div', { className: 'ms-hall-vignette', 'aria-hidden': true })))),
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
        !query && detail
          ? h('div', {
            className: 'ms-card',
            key: detail.id,
            role: 'status',
            'aria-live': 'polite',
            style: { maxHeight: '42vh', overflowY: 'auto' },
          },
          detail.status === 'loading'
            ? '读取中…'
            : detail.status === 'error'
              ? '这条读不出来了'
              : (() => {
                const chars = Array.from(String(detail.text ?? ''));
                const overflow = chars.length > CARD_PREVIEW_LIMIT;
                const shown = !overflow || cardExpanded ? chars.join('') : chars.slice(0, CARD_PREVIEW_LIMIT).join('') + '…';
                return h('div', null,
                  h('p', { className: 'ms-card-text', style: { margin: 0, whiteSpace: 'pre-wrap' } }, shown),
                  overflow
                    ? h('button', {
                      type: 'button',
                      className: 'ms-link',
                      onClick: () => setCardExpanded((value) => !value),
                    }, cardExpanded ? '收起' : `展开全文（${chars.length} 字）`)
                    : null,
                  h('p', { className: 'ms-muted', style: { margin: '4px 0 0' } },
                    `${ballPalette(detail.type).label} · ${ballDayLabel(detail.recorded_at)}`),
                  h('p', { className: 'ms-muted', style: { margin: '6px 0 0' } }, '再次点击收起'));
              })())
          : null,
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
              : '滚轮换架：往前更旧、往后更新；点亮一颗球看正文，再点一次收起。'),
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
      __test: { ReviewList, resolveMemory, fetchMemory, MemoryPanel, MemoryShell: MemoryPanel, MemoryShelf, hallWallCount, hallHasNext, hallCells, hallIndex, hallMetrics, ballStyle },
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
