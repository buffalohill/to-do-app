import './style.css'
import { supabase } from './supabase.js'

let todos = []

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
    <li class="todo-item${todo.is_complete ? ' todo-item--completed' : ''}" data-id="${todo.id}">
      <input
        type="checkbox"
        class="todo-checkbox"
        ${todo.is_complete ? 'checked' : ''}
        aria-label="Mark complete"
      />
      <span class="todo-text">${escapeHtml(todo.text)}</span>
      <button type="button" class="todo-delete-button">Delete</button>
    </li>
  `,
    )
    .join('')
}

async function loadTodos() {
  const { data, error } = await supabase
    .from('todos')
    .select('id, text, is_complete, created_at')
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Failed to load todos:', error.message)
    return
  }

  todos = data
  render()
}

async function addTodo(text) {
  const { error } = await supabase.from('todos').insert({ text, is_complete: false })

  if (error) {
    console.error('Failed to add todo:', error.message)
    return
  }

  input.value = ''
  input.focus()
  await loadTodos()
}

async function toggleTodo(id, isComplete) {
  const { error } = await supabase
    .from('todos')
    .update({ is_complete: isComplete })
    .eq('id', id)

  if (error) {
    console.error('Failed to update todo:', error.message)
    await loadTodos()
    return
  }

  await loadTodos()
}

async function deleteTodo(id) {
  const { error } = await supabase.from('todos').delete().eq('id', id)

  if (error) {
    console.error('Failed to delete todo:', error.message)
    return
  }

  await loadTodos()
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const text = input.value.trim()
  if (!text) return
  await addTodo(text)
})

list.addEventListener('change', async (event) => {
  if (!event.target.matches('.todo-checkbox')) return
  const item = event.target.closest('.todo-item')
  const id = Number(item.dataset.id)
  await toggleTodo(id, event.target.checked)
})

list.addEventListener('click', async (event) => {
  if (!event.target.matches('.todo-delete-button')) return
  const item = event.target.closest('.todo-item')
  const id = Number(item.dataset.id)
  await deleteTodo(id)
})

loadTodos()
