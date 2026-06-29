import './style.css'
import { supabase } from './supabase.js'

let todos = []
let currentUser = null
let draggedTodoId = null
let dropInsertIndex = null

const form = document.getElementById('todo-form')
const input = document.getElementById('todo-input')
const list = document.getElementById('todo-list')
const authGuest = document.getElementById('auth-guest')
const authUser = document.getElementById('auth-user')
const userEmail = document.getElementById('user-email')
const signUpForm = document.getElementById('sign-up-form')
const signInForm = document.getElementById('sign-in-form')
const signUpFeedback = document.getElementById('sign-up-feedback')
const signInFeedback = document.getElementById('sign-in-feedback')
const signOutButton = document.getElementById('sign-out-button')
const showSignUpButton = document.getElementById('show-sign-up')
const showSignInButton = document.getElementById('show-sign-in')

const dropIndicator = document.createElement('div')
dropIndicator.className = 'todo-drop-indicator'
dropIndicator.hidden = true
list.appendChild(dropIndicator)

let authReady = false
let authBootstrapped = false

function escapeHtml(text) {
  const el = document.createElement('span')
  el.textContent = text
  return el.innerHTML
}

function isPermanentUser(user) {
  return Boolean(user && !user.is_anonymous && user.email)
}

function showTodoError(message) {
  if (!message) return
  list.querySelectorAll('.todo-item').forEach((el) => el.remove())
  const li = document.createElement('li')
  li.className = 'todo-item'
  li.textContent = message
  list.insertBefore(li, dropIndicator)
}

async function getSessionUser() {
  const { data: { session }, error } = await supabase.auth.getSession()

  if (error) {
    console.error('Failed to get session:', error.message)
    return null
  }

  if (session?.user) {
    currentUser = session.user
    return session.user
  }

  return ensureSession()
}

function setAuthFeedback(element, message, isError = false) {
  if (!message) {
    element.hidden = true
    element.textContent = ''
    element.classList.remove('auth-feedback--error')
    return
  }

  element.hidden = false
  element.textContent = message
  element.classList.toggle('auth-feedback--error', isError)
}

function showAuthForm(mode) {
  const showSignUp = mode === 'sign-up'
  const showSignIn = mode === 'sign-in'

  signUpForm.hidden = !showSignUp
  signInForm.hidden = !showSignIn
  showSignUpButton.classList.toggle('auth-toggle-button--active', showSignUp)
  showSignInButton.classList.toggle('auth-toggle-button--active', showSignIn)
  showSignUpButton.setAttribute('aria-expanded', String(showSignUp))
  showSignInButton.setAttribute('aria-expanded', String(showSignIn))

  if (showSignUp) {
    signUpForm.querySelector('input')?.focus()
  } else if (showSignIn) {
    signInForm.querySelector('input')?.focus()
  }
}

function closeAuthForms() {
  signUpForm.hidden = true
  signInForm.hidden = true
  showSignUpButton.classList.remove('auth-toggle-button--active')
  showSignInButton.classList.remove('auth-toggle-button--active')
  showSignUpButton.setAttribute('aria-expanded', 'false')
  showSignInButton.setAttribute('aria-expanded', 'false')
}

function updateAuthUI(user) {
  const showGuest = !isPermanentUser(user)

  authGuest.hidden = !showGuest
  authUser.hidden = showGuest

  if (isPermanentUser(user)) {
    userEmail.textContent = user.email
    userEmail.title = user.email
    closeAuthForms()
  }
}

function render() {
  list.querySelectorAll('.todo-item').forEach((el) => el.remove())

  todos.forEach((todo) => {
    const li = document.createElement('li')
    li.className = `todo-item${todo.is_complete ? ' todo-item--completed' : ''}`
    li.dataset.id = String(todo.id)
    li.innerHTML = `
      <button type="button" class="todo-drag-handle" draggable="true" aria-label="Reorder">⋮⋮</button>
      <input
        type="checkbox"
        class="todo-checkbox"
        ${todo.is_complete ? 'checked' : ''}
        aria-label="Mark complete"
      />
      <span class="todo-text">${escapeHtml(todo.text)}</span>
      <button type="button" class="todo-delete-button">Delete</button>
    `
    list.insertBefore(li, dropIndicator)
  })
}

async function ensureSession() {
  const { data, error } = await supabase.auth.signInAnonymously()

  if (error) {
    console.error('Failed to sign in anonymously:', error.message)
    return null
  }

  currentUser = data.user
  return data.user
}

async function handleAuthState(user) {
  currentUser = user
  updateAuthUI(user)

  if (!user) {
    list.querySelectorAll('.todo-item').forEach((el) => el.remove())
    const li = document.createElement('li')
    li.className = 'todo-item'
    li.textContent =
      'Sign-in failed. Enable anonymous auth in Supabase (Authentication → Providers → Anonymous).'
    list.insertBefore(li, dropIndicator)
    return
  }

  await loadTodos()
}

async function loadTodos() {
  const user = await getSessionUser()
  if (!user) return

  const { data, error } = await supabase
    .from('todos')
    .select('id, text, is_complete, sort_order')
    .eq('user_id', user.id)
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('Failed to load todos:', error.message)
    showTodoError(`Could not load todos: ${error.message}`)
    return
  }

  todos = data
  render()
}

async function signUpAccount(email, password) {
  if (currentUser?.is_anonymous) {
    // Upgrade the anonymous session — same user ID, so existing todos carry over
    const { data: combinedData, error: combinedError } = await supabase.auth.updateUser({
      email,
      password,
    })

    if (!combinedError) {
      return { user: combinedData.user }
    }

    const { data: emailData, error: emailError } = await supabase.auth.updateUser({ email })
    if (emailError) throw emailError

    const { data: passwordData, error: passwordError } = await supabase.auth.updateUser({ password })
    if (passwordError) {
      return {
        user: emailData.user,
        needsVerification: true,
        message: 'Check your email to verify your account, then sign in with your password.',
      }
    }

    return { user: passwordData.user }
  }

  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error

  return {
    user: data.user,
    needsVerification: !data.session,
    message: data.session
      ? null
      : 'Check your email to confirm your account, then sign in.',
  }
}

async function signInAccount(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data.user
}

async function addTodo(text) {
  const user = await getSessionUser()
  if (!user) {
    showTodoError('Could not add todo: no active session.')
    return
  }

  const maxSortOrder = todos.length > 0 ? Math.max(...todos.map((t) => t.sort_order)) : -1

  const { error } = await supabase.from('todos').insert({
    text,
    is_complete: false,
    user_id: user.id,
    sort_order: maxSortOrder + 1,
  })

  if (error) {
    console.error('Failed to add todo:', error.message)
    showTodoError(`Could not add todo: ${error.message}`)
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

function reorderTodos(fromIndex, insertIndex) {
  if (insertIndex === fromIndex || insertIndex === fromIndex + 1) return

  const [moved] = todos.splice(fromIndex, 1)
  const toIndex = insertIndex > fromIndex ? insertIndex - 1 : insertIndex
  todos.splice(toIndex, 0, moved)

  todos.forEach((todo, index) => {
    todo.sort_order = index
  })

  render()
  persistSortOrder()
}

function getInsertIndex(clientY) {
  const items = [...list.querySelectorAll('.todo-item')]
  if (items.length === 0) return 0

  for (let i = 0; i < items.length; i++) {
    const rect = items[i].getBoundingClientRect()
    if (clientY < rect.top + rect.height / 2) return i
  }

  return items.length
}

function positionDropIndicator(insertIndex) {
  const items = list.querySelectorAll('.todo-item')

  if (items.length === 0) {
    dropIndicator.hidden = true
    return
  }

  const fromIndex = todos.findIndex((t) => t.id === draggedTodoId)
  if (insertIndex === fromIndex || insertIndex === fromIndex + 1) {
    dropIndicator.hidden = true
    return
  }

  let y
  if (insertIndex === 0) {
    y = items[0].offsetTop
  } else if (insertIndex >= items.length) {
    const last = items[items.length - 1]
    y = last.offsetTop + last.offsetHeight
  } else {
    const prev = items[insertIndex - 1]
    const next = items[insertIndex]
    y = (prev.offsetTop + prev.offsetHeight + next.offsetTop) / 2
  }

  dropIndicator.style.top = `${y}px`
  dropIndicator.hidden = false
}

function clearDropIndicator() {
  dropInsertIndex = null
  dropIndicator.hidden = true
}

async function persistSortOrder() {
  const updates = todos.map((todo) =>
    supabase.from('todos').update({ sort_order: todo.sort_order }).eq('id', todo.id),
  )

  const results = await Promise.all(updates)
  const error = results.find((r) => r.error)?.error

  if (error) {
    console.error('Failed to persist sort order:', error.message)
    await loadTodos()
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const text = input.value.trim()
  if (!text) return
  await addTodo(text)
})

signUpForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  setAuthFeedback(signUpFeedback, '')

  const email = signUpForm.email.value.trim()
  const password = signUpForm.password.value

  try {
    const result = await signUpAccount(email, password)
    signUpForm.reset()

    if (result.needsVerification) {
      setAuthFeedback(signUpFeedback, result.message)
      return
    }

    await handleAuthState(result.user)
    setAuthFeedback(signUpFeedback, 'Account created.')
  } catch (error) {
    setAuthFeedback(signUpFeedback, error.message, true)
  }
})

signInForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  setAuthFeedback(signInFeedback, '')

  const email = signInForm.email.value.trim()
  const password = signInForm.password.value

  try {
    const user = await signInAccount(email, password)
    signInForm.reset()
    await handleAuthState(user)
  } catch (error) {
    setAuthFeedback(signInFeedback, error.message, true)
  }
})

signOutButton.addEventListener('click', async () => {
  setAuthFeedback(signUpFeedback, '')
  setAuthFeedback(signInFeedback, '')
  closeAuthForms()

  const { error } = await supabase.auth.signOut()
  if (error) {
    console.error('Failed to sign out:', error.message)
    return
  }

  const user = await ensureSession()
  await handleAuthState(user)
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

list.addEventListener('dragstart', (event) => {
  const handle = event.target.closest('.todo-drag-handle')
  if (!handle) return

  const item = handle.closest('.todo-item')
  draggedTodoId = Number(item.dataset.id)
  item.classList.add('todo-item--dragging')
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', String(draggedTodoId))
})

list.addEventListener('dragover', (event) => {
  if (draggedTodoId === null) return

  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'

  dropInsertIndex = getInsertIndex(event.clientY)
  positionDropIndicator(dropInsertIndex)
})

list.addEventListener('dragleave', (event) => {
  if (!list.contains(event.relatedTarget)) {
    clearDropIndicator()
  }
})

list.addEventListener('drop', (event) => {
  event.preventDefault()

  const fromIndex = todos.findIndex((t) => t.id === draggedTodoId)
  const insertIndex = dropInsertIndex ?? getInsertIndex(event.clientY)

  list.querySelectorAll('.todo-item--dragging').forEach((el) => {
    el.classList.remove('todo-item--dragging')
  })

  clearDropIndicator()
  draggedTodoId = null

  if (fromIndex === -1) return
  reorderTodos(fromIndex, insertIndex)
})

list.addEventListener('dragend', () => {
  draggedTodoId = null
  clearDropIndicator()
  list.querySelectorAll('.todo-item--dragging').forEach((el) => {
    el.classList.remove('todo-item--dragging')
  })
})

showSignUpButton.addEventListener('click', () => {
  setAuthFeedback(signInFeedback, '')
  showAuthForm(signUpForm.hidden ? 'sign-up' : null)
})

showSignInButton.addEventListener('click', () => {
  setAuthFeedback(signUpFeedback, '')
  showAuthForm(signInForm.hidden ? 'sign-in' : null)
})

async function bootstrapAuth(sessionUser) {
  if (authBootstrapped) return
  authBootstrapped = true
  authReady = true

  if (sessionUser) {
    await handleAuthState(sessionUser)
    return
  }

  const user = await ensureSession()
  await handleAuthState(user)
}

async function init() {
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'INITIAL_SESSION') {
      await bootstrapAuth(session?.user ?? null)
      return
    }

    if (!authReady) return

    if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
      if (session?.user) await handleAuthState(session.user)
      return
    }

    if (event === 'TOKEN_REFRESHED') {
      if (session?.user) currentUser = session.user
      return
    }

    if (event === 'SIGNED_OUT') {
      const user = await ensureSession()
      await handleAuthState(user)
    }
  })

  if (!authBootstrapped) {
    const { data: { session } } = await supabase.auth.getSession()
    await bootstrapAuth(session?.user ?? null)
  }
}

init()
