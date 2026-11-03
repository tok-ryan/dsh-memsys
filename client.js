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

    function MemorySettings() {
      const [state, setState] = React.useState(null);
      const [note, setNote] = React.useState('');
      React.useEffect(() => {
        fetch(API)
          .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
          .then(setState)
          .catch(() => setState({ error: true }));
      }, []);
      const save = (value) => {
        const previous = state?.auto_inject === true;
        setState((current) => ({ ...(current ?? {}), auto_inject: value }));
        setNote('保存中…');
        fetch(CONFIG, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ auto_inject: value }),
        })
          .then((response) => (response.ok ? setNote('已保存') : Promise.reject(new Error(String(response.status)))))
          .catch(() => {
            setState((current) => ({ ...(current ?? {}), auto_inject: previous }));
            setNote('保存失败');
          });
      };
      return h(
        'div',
        { style: { padding: '8px 0', lineHeight: 1.7 } },
        h('label', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h('input', {
            type: 'checkbox',
            checked: state?.auto_inject === true,
            disabled: !state || state.error === true,
            onChange: (event) => save(event.target.checked),
          }),
          '自动注入记忆',
        ),
        h('p', { style: { opacity: 0.75, margin: '6px 0 0' } }, `数据目录：${state?.data_dir ?? '未配置'}`),
        h('p', { style: { opacity: 0.75, margin: '4px 0 0' } },
          `当前生效值来源：${SOURCE_LABEL[state?.auto_inject_source] ?? state?.auto_inject_source ?? '未知'}`),
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
