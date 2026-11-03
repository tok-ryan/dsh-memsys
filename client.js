window.__ModuleLoader__.load({
  id: 'dsh-memsys',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'dsh-memsys';
    const API = '/dsh-memsys/api/summary';
    const CONFIG = '/dsh-memsys/api/config';

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
      '@keyframes msFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}',
      '.ms-panel{padding:16px;line-height:1.7}',
      '.ms-counts{margin:0 0 12px;opacity:.85}',
      '.ms-shelf{display:flex;gap:16px;align-items:flex-end;padding:12px 16px 8px;margin:0 0 10px;border-radius:12px;',
      'background:linear-gradient(180deg,rgba(127,127,127,.10),rgba(127,127,127,.03));',
      'box-shadow:inset 0 -1px 0 rgba(127,127,127,.28)}',
      '.ms-ball{width:44px;height:44px;border-radius:50%;border:0;padding:0;cursor:pointer;position:relative;',
      'background:radial-gradient(circle at 32% 27%,rgba(255,255,255,.95),rgba(255,255,255,.28) 16%,var(--ms-c) 60%,rgba(0,0,0,.45) 100%);',
      'box-shadow:inset -6px -8px 14px rgba(0,0,0,.30),inset 6px 6px 12px rgba(255,255,255,.22),0 4px 10px rgba(0,0,0,.18);',
      'animation:msFloat 5s ease-in-out infinite;transition:transform .15s ease,box-shadow .15s ease}',
      '.ms-ball:hover,.ms-ball:focus-visible{transform:scale(1.06);',
      'box-shadow:inset -6px -8px 14px rgba(0,0,0,.30),inset 6px 6px 12px rgba(255,255,255,.22),0 0 18px 4px var(--ms-glow);outline:none}',
      '.ms-ball[aria-pressed="true"]{transform:scale(1.06);box-shadow:0 0 18px 4px var(--ms-glow)}',
      '.ms-empty{width:44px;height:44px;border-radius:50%;border:1px dashed rgba(127,127,127,.35);background:rgba(127,127,127,.05)}',
      '.ms-card{margin-top:10px;padding:12px 14px;border-radius:10px;background:rgba(127,127,127,.08);font-size:.95em}',
      '.ms-hint{opacity:.75;margin:6px 0 0}',
      '@media (prefers-reduced-motion:reduce){.ms-ball{animation:none}}',
    ].join('');
    const BALL_COLORS = ['#3fa7ff', '#5b8cff', '#7a6bff', '#8f5bd8', '#8450a8'];
    const BALL_GLOWS = [
      'rgba(63,167,255,.45)',
      'rgba(91,140,255,.45)',
      'rgba(122,107,255,.45)',
      'rgba(143,91,216,.45)',
      'rgba(132,80,168,.45)',
    ];
    const EMPTY_SLOTS = 5;
    const CARD_TEXT_LIMIT = 120;

    function MemoryPanel() {
      const [state] = useSummary();
      const [selectedId, setSelectedId] = React.useState(null);
      if (!state) return h('p', { className: 'ms-panel' }, '读取记忆…');
      if (state.error) return h('p', { className: 'ms-panel' }, '暂时读不到记忆数据。');
      const recent = state.recent ?? [];
      const selected = recent.find((memory) => memory.id === selectedId) ?? null;
      // Pad with ghost slots so an almost-empty shelf keeps its shape.
      const shelf = [];
      for (let index = 0; index < Math.max(recent.length, EMPTY_SLOTS); index += 1) shelf.push(recent[index] ?? null);
      return h(
        'div',
        { className: 'ms-panel' },
        h('style', { dangerouslySetInnerHTML: { __html: BALL_CSS } }),
        h('h2', { style: { margin: '0 0 8px' } }, '记忆'),
        h('p', { className: 'ms-counts' },
          `记忆 ${state.memories} 条 · 候选 ${state.candidates} 条 · 待确认惦记 ${state.pending_due} 条`),
        h('div', { className: 'ms-shelf', role: 'list', 'aria-label': '最近的记忆' },
          shelf.map((memory, index) => memory === null
            ? h('span', { key: `empty-${index}`, className: 'ms-empty', 'aria-hidden': true })
            : h('button', {
              key: memory.id,
              type: 'button',
              role: 'listitem',
              className: 'ms-ball',
              'aria-pressed': selectedId === memory.id,
              'aria-label': memory.text,
              title: memory.text,
              style: {
                '--ms-c': BALL_COLORS[Math.min(index, BALL_COLORS.length - 1)],
                '--ms-glow': BALL_GLOWS[Math.min(index, BALL_GLOWS.length - 1)],
                animationDelay: `${index * 0.35}s`,
                width: `${44 - Math.min(index, 3) * 2}px`,
                height: `${44 - Math.min(index, 3) * 2}px`,
              },
              onClick: () => setSelectedId(selectedId === memory.id ? null : memory.id),
            })),
        ),
        recent.length === 0
          ? h('p', { className: 'ms-hint' }, '还没有记忆。去跟模型说一句「记住：…」吧')
          : h('p', { className: 'ms-hint' }, '点亮一颗球，看看它装的是什么。'),
        selected
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
        h('p', { style: { opacity: 0.75, margin: '10px 0 0' } }, `数据目录：${state?.data_dir ?? '未配置'}`),
        h('p', { style: { opacity: 0.75, margin: '4px 0 0' } },
          `当前生效值来源：${SOURCE_LABEL[state?.modules_source] ?? state?.modules_source ?? '未知'}`),
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
