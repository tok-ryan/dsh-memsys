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

    function MemoryPanel() {
      const [state] = useSummary();
      if (!state) return h('p', { style: { padding: 16 } }, '读取记忆…');
      if (state.error) return h('p', { style: { padding: 16 } }, '暂时读不到记忆数据。');
      return h(
        'div',
        { style: { padding: 16, lineHeight: 1.7 } },
        h('h2', { style: { margin: '0 0 8px' } }, '记忆'),
        h('p', null, `记忆 ${state.memories} 条 · 候选 ${state.candidates} 条 · 待确认惦记 ${state.pending_due} 条`),
        h('h3', { style: { margin: '16px 0 6px' } }, '最近 5 条'),
        state.recent.length === 0
          ? h('p', null, '还没有记忆。')
          : h('ul', null, state.recent.map((memory) => h('li', { key: memory.id }, memory.text))),
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
