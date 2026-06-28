import './style.css'

const todos = []
let nextId = 1

const form = document.getElementById('todo-form')
const input = document.getElementById('todo-input')
const list = document.getElementById('todo-list')

function escapeHtml(text) {
  const el = document.createElement('span')
  el.textContent = text
  return el.innerHTML
}

function render() {
  list.innerHTML = todos
    .map(
      (todo) => `
    <li class="todo-item${todo.completed ? ' todo-item--completed' : ''}" data-id="${todo.id}">
      <input
        type="checkbox"
        class="todo-checkbox"
        ${todo.completed ? 'checked' : ''}
        aria-label="Mark complete"
      />
      <span class="todo-text">${escapeHtml(todo.text)}</span>
      <button type="button" class="todo-delete-button">Delete</button>
    </li>
  `,
    )
    .join('')
}

function addTodo(text) {
  todos.push({ id: nextId++, text, completed: false })
  render()
}

function toggleTodo(id, completed) {
  const todo = todos.find((item) => item.id === id)
  if (!todo) return
  todo.completed = completed
  render()
}

function deleteTodo(id) {
  const index = todos.findIndex((item) => item.id === id)
  if (index === -1) return
  todos.splice(index, 1)
  render()
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  const text = input.value.trim()
  if (!text) return
  addTodo(text)
  input.value = ''
  input.focus()
})

list.addEventListener('change', (event) => {
  if (!event.target.matches('.todo-checkbox')) return
  const item = event.target.closest('.todo-item')
  const id = Number(item.dataset.id)
  toggleTodo(id, event.target.checked)
})

list.addEventListener('click', (event) => {
  if (!event.target.matches('.todo-delete-button')) return
  const item = event.target.closest('.todo-item')
  const id = Number(item.dataset.id)
  deleteTodo(id)
})

render()
