import Preact from 'preact';

const makeEvent = (f = () => {}, initialValue = null) => {
	let subscribers = [];
	let value = initialValue;
	const event  = {
		get value () {
			return value;
		},

		map (f) {
			const event = makeEvent();
			subscribers.push(v => event.fire(f(v)));
			return event;
		},

		filter (f) {
			const event = makeEvent();
			subscribers.push(v => f(v) && event.fire(v));
			return event;
		},

		reduce (f, initialValue) {
			let acc = initialValue;
			const event = makeEvent(() => {}, acc);
			subscribers.push(v => {
				acc = f(acc, v);
				event.fire(acc);
			});
			return event;
		},

		fire (v) {
			value = v;
			subscribers.forEach(f => f(v));
		},

		subscribe (f) {
			subscribers.push(f);
		},

		tag (e) {
			return e.map(() => value);
		}
	};
	f(event.fire);
	return event;
};

const makeEventCollector = (reducer, initialValue = null) => {
	const event = makeEvent();
	return {
		collect (e) {
			e.subscribe(event.fire);
		},

		get signal () {
			return event.reduce(reducer, initialValue);
		}
	};
};


class HoC extends Preact.Component {
	constructor(props) {
		super(props);
		this.state = { sigVal: this.props.signal.value };
	}

	componentDidMount () {
		this.props.signal.subscribe(sigVal => this.setState({ sigVal }));
	}

	render () {
		const i = makeI(this.props.env);
		this.props.drawer(this.state.sigVal)(i);
		return i.el();
	}
}

class CollectHoC extends Preact.Component {
	constructor(props) {
		super(props);
		this.eventCollector = makeEventCollector(this.props.reducer, this.props.initialValue);
	}

	render () {
		this.props.drawer(this.eventCollector)(this.props.i);
		return this.props.i.el();
	}
}

const TheComponent = ({ iChildren }) => <div>{ iChildren }</div>;

const makeI = (env) => {
	let iChildren = [];
	let collectors = {};
	return {
		get children () { return iChildren; },
		get env () { return env; },
		get collectors () { return collectors; },

		el (key = null) {
			return key ?
				<TheComponent key={key} iChildren={iChildren} /> :
				<TheComponent iChildren={iChildren} />;
		},

		text (t) {
			iChildren.push(t);
		},

		dom (tag, config, drawer = () => {}) {
			const {
				attrs = {},
				events = []
			} = config;
			const backup = iChildren;
			iChildren = [];
			drawer(this);
			const allEvents = makeEvent(fire => {
				const eventProps = {};
				events.forEach(eventType => {
					eventProps[eventType] = rawEvent => fire({ eventType, rawEvent });
				});
				const el = Preact.createElement(
					tag, { key: backup.length, ...attrs, ...eventProps }, iChildren.length ? iChildren : null
				);
				backup.push(el);
				iChildren = backup;
			});
			const res = {};
			events.forEach(event => {
				res[event] = allEvents
					.filter(({ eventType }) => eventType === event)
					.map(({ rawEvent }) => rawEvent);
			});
			return res;
		},

		withEnv (env, drawer) {
			const i = makeI(env);
			const res = drawer(i);
			iChildren.push(i.el(iChildren.length));
			return res;
		},

		withSignal (signal, drawer) {
			iChildren.push(<HoC signal={signal} drawer={drawer} env={env} key={iChildren.length} />);
		},

		withEventCollector (reducer, initialValue, drawer) {
			iChildren.push(<CollectHoC i={makeI(env)} reducer={reducer} initialValue={initialValue} drawer={drawer} key={iChildren.length} />);
		}
	};
};

const toComponent = (iRenderer, env = {}) => {
	const i = makeI(env);
	iRenderer(i);
	return () => i.el();
};

const drawTodo = (i, collect) => (todo, id) => {
	i.withEventCollector((acc, val) => val, false, editCollector => i => {
		const editSignal = editCollector.signal;
		i.withSignal(editSignal, editing => i => {
			i.dom('li', { attrs: { className: `${editing ? 'editing ' : ''}${todo.completed ? 'completed ': ''}` } }, () => {
				if (editing) {
					const { onBlur, onKeyDown, onChange } = i.dom('input', {
						attrs: {
							className: 'edit',
							autoFocus: true,
							defaultValue: todo.text
						},
						events: ['onBlur', 'onKeyDown', 'onChange']
					});
					editCollector.collect(onBlur.map(() => false));
					const keyCodes = onKeyDown
						.map(e => e.charCode || e.keyCode);
					const enters = keyCodes.filter(keyCode => keyCode === 13);
					const escapes = keyCodes.filter(keyCode => keyCode === 27);
					editCollector.collect(escapes.map(() => false));
					const inputValue = onChange.map(e => e.target.value);
					const editTodoEvents = inputValue
						.tag(enters)
						.filter(s => s && s !== '')
						.map(s => ({ type: 'editTodo', id, todoText: s }));
					collect(editTodoEvents);
				}
				else {
					i.dom('div', { attrs: { className: 'view' } }, () => {
						const { onChange } = i.dom('input', {
							attrs: { className: 'toggle', type: 'checkbox', defaultChecked: todo.completed },
							events: ['onChange']
						});
						const completedSignal = onChange
							.map(e => e.target.checked)
							.reduce((acc, val) => val, todo.completed);
						collect(completedSignal.map(completed => ({ type: 'setCompleted', id, completed })));
						const { onDoubleClick } = i.dom('label', { events: ['onDoubleClick'] }, () => i.text(todo.text));
						editCollector.collect(onDoubleClick.map(() => true));
						const { onClick } = i.dom('button', { attrs: { className: 'destroy' }, events: ['onClick'] });
						collect(onClick.map(() => ({ type: 'deleteTodo', id })));
					});
				}
			});
		});
	});
};

const App = i => {
	i.withEventCollector(
		(todos, { type, ...event }) => {
			if (type === 'addTodo') {
				return [{ text: event.todoText, completed: false }, ...todos];
			}
			if (type === 'deleteTodo') {
				return todos.filter((todo, id) => id !== event.id);
			}
			if (type === 'editTodo') {
				return todos.map((todo, id) => id === event.id ? { ...todo, text: event.todoText } : todo);
			}
			if (type === 'setCompleted') {
				return todos.map((todo, id) => id === event.id ? { ...todo, completed: event.completed } : todo);
			}
			return todos;
		},
		[],
		({ signal: todoStore, collect }) => i => {
			todoStore.subscribe(console.log);
			i.dom('div', {}, () => {
				i.dom('section', { attrs: { className: 'todoapp' } }, () => {
					i.dom('header', { attrs: { className: 'header' } }, () => {
						i.dom('h1', {}, () => i.text('todos'));
						let myRef;
						const { onKeyDown, onInput } = i.dom('input', {
							attrs: {
								className: 'new-todo',
								placeholder: 'What needs to be done?',
								autoFocus: true,
								ref: ref => { myRef = ref; }
							},
							events: ['onKeyDown', 'onInput']
						});
						const enters = onKeyDown
							.map(e => e.charCode || e.keyCode)
							.filter(keyCode => keyCode === 13);
						enters.subscribe(() => myRef.value = '');
						const inputValue = onInput.map(e => e.target.value);
						const addTodoEvents = inputValue
							.tag(enters)
							.filter(s => s && s !== '')
							.map(s => ({ type: 'addTodo', todoText: s }));
						collect(addTodoEvents);
					});
					i.withSignal(todoStore, todos => i => {
						i.dom('div', {}, () => {
							i.dom('section', { attrs: { className: 'main' } }, () => {
								i.dom('ul', { attrs: { className: 'todo-list' } }, () => {
									todos.forEach(drawTodo(i, collect));
								});
							});
						});
					});
				});
				i.dom('footer', { attrs: { className: 'info' } }, () => {
					i.dom('p', {}, () => i.text('Double-click to edit a todo'));
					i.dom('p', {}, () => i.text('Written by Mitch Dzugan'));
					i.dom('p', {}, () => {
						i.text('Based on template at ');
						i.dom('a', { attrs: { href: 'https://github.com/tastejs/todomvc-app-template' } }, () => i.text('tastejs/todomvc-app-template'));
					});
				});
			});
		}
	);
};

export default toComponent(App);
