// =============================================================================
// MY TODO APP — main entry point
// This file wires up the UI, talks to Supabase, and keeps everything in sync.
// =============================================================================

import './style.css'
import { supabase } from './supabase.js'

// -----------------------------------------------------------------------------
// App state — these variables change as the user interacts with the app
// -----------------------------------------------------------------------------

let todos = [] // All todos for the current user, loaded from the database
let currentUser = null // The Supabase user object (anonymous or signed-in)
let editingTodoId = null // Which todo is being edited inline (null = none)
let editingOriginalText = null // Text before editing, used to skip no-op saves

// Drag-and-drop reorder state
let draggedTodoId = null
let dropInsertIndex = null
let dragState = null // Full pointer-drag session (ghost element, offsets, etc.)

// Auth bootstrap flags — prevent double-loading on startup
let authReady = false
let authBootstrapped = false

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

// Pixels the pointer must move before a press becomes a drag (avoids accidental drags)
const DRAG_THRESHOLD = 6

// SVG icons injected into edit / confirm / delete buttons (currentColor inherits from CSS)
const EDIT_ICON = `<svg class="todo-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10.5 2.5l3 3L5.5 13.5H2.5v-3L10.5 2.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`
const CONFIRM_ICON = `<svg class="todo-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8.5l3.5 3.5 6.5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
const DELETE_ICON = `<svg class="todo-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`

// -----------------------------------------------------------------------------
// DOM references — grab elements once so we don't query the page repeatedly
// -----------------------------------------------------------------------------

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

// Drop indicator: a horizontal line that shows where a dragged item will land
const dropIndicator = document.createElement('div')
dropIndicator.className = 'todo-drop-indicator'
dropIndicator.hidden = true
list.appendChild(dropIndicator)

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------

/** Escape text so it is safe to insert into HTML (prevents XSS). */
function escapeHtml(text) {
  const el = document.createElement('span')
  el.textContent = text
  return el.innerHTML
}

/** True when the user has a real email account (not an anonymous guest session). */
function isPermanentUser(user) {
  return Boolean(user && !user.is_anonymous && user.email)
}

/** Clear inline-edit mode. */
function resetEditState() {
  editingTodoId = null
  editingOriginalText = null
}

/** Show a single message row in the todo list (errors, empty states, etc.). */
function showListMessage(message) {
  list.querySelectorAll('.todo-item').forEach((el) => el.remove())
  const li = document.createElement('li')
  li.className = 'todo-item'
  li.textContent = message
  list.insertBefore(li, dropIndicator)
}

// -----------------------------------------------------------------------------
// Auth UI
// -----------------------------------------------------------------------------

/** Show or hide a feedback message under a sign-up / sign-in form. */
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

/** Open the sign-up or sign-in form. Pass null to close both (toggle behaviour). */
function showAuthForm(mode) {
  if (!mode) {
    closeAuthForms()
    return
  }

  const showSignUp = mode === 'sign-up'
  const showSignIn = mode === 'sign-in'

  signUpForm.hidden = !showSignUp
  signInForm.hidden = !showSignIn
  showSignUpButton.classList.toggle('auth-toggle-button--active', showSignUp)
  showSignInButton.classList.toggle('auth-toggle-button--active', showSignIn)
  showSignUpButton.setAttribute('aria-expanded', String(showSignUp))
  showSignInButton.setAttribute('aria-expanded', String(showSignIn))

  const activeForm = showSignUp ? signUpForm : showSignIn ? signInForm : null
  activeForm?.querySelector('input')?.focus()
}

/** Hide both auth forms and reset toggle button styles. */
function closeAuthForms() {
  signUpForm.hidden = true
  signInForm.hidden = true
  showSignUpButton.classList.remove('auth-toggle-button--active')
  showSignInButton.classList.remove('auth-toggle-button--active')
  showSignUpButton.setAttribute('aria-expanded', 'false')
  showSignInButton.setAttribute('aria-expanded', 'false')
}

/** Swap between guest auth panel and signed-in user panel. */
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

// -----------------------------------------------------------------------------
// Session management
// -----------------------------------------------------------------------------

/** Return the current Supabase session user, or create an anonymous one. */
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

/** Sign in anonymously so guests can use todos without creating an account. */
async function ensureSession() {
  const { data, error } = await supabase.auth.signInAnonymously()

  if (error) {
    console.error('Failed to sign in anonymously:', error.message)
    return null
  }

  currentUser = data.user
  return data.user
}

/** React to any auth change: update UI and reload todos. */
async function handleAuthState(user) {
  currentUser = user
  updateAuthUI(user)

  if (!user) {
    showListMessage(
      'Sign-in failed. Enable anonymous auth in Supabase (Authentication → Providers → Anonymous).',
    )
    return
  }

  await loadTodos()
}

/** Create a new account, or upgrade an anonymous session to a permanent one. */
async function signUpAccount(email, password) {
  if (currentUser?.is_anonymous) {
    // Upgrade anonymous session — same user ID, so existing todos carry over
    const { data: combinedData, error: combinedError } = await supabase.auth.updateUser({
      email,
      password,
    })

    if (!combinedError) {
      return { user: combinedData.user }
    }

    // Some Supabase configs require email and password in separate steps
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

/** Sign in with email and password. */
async function signInAccount(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data.user
}

// -----------------------------------------------------------------------------
// Todo CRUD (Create, Read, Update, Delete) via Supabase
// -----------------------------------------------------------------------------

/** Fetch all todos for the current user from the database. */
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
    showListMessage(`Could not load todos: ${error.message}`)
    return
  }

  todos = data
  render()
}

/** Insert a new todo at the end of the list. */
async function addTodo(text) {
  const user = await getSessionUser()
  if (!user) {
    showListMessage('Could not add todo: no active session.')
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
    showListMessage(`Could not add todo: ${error.message}`)
    return
  }

  input.value = ''
  input.focus()
  await loadTodos()
}

/** Toggle the completed checkbox for one todo. */
async function toggleTodo(id, isComplete) {
  const { error } = await supabase
    .from('todos')
    .update({ is_complete: isComplete })
    .eq('id', id)

  if (error) console.error('Failed to update todo:', error.message)
  await loadTodos()
}

/** Remove a todo from the database. */
async function deleteTodo(id) {
  const { error } = await supabase.from('todos').delete().eq('id', id)

  if (error) {
    console.error('Failed to delete todo:', error.message)
    return
  }

  await loadTodos()
}

/** Save edited todo text to the database. */
async function updateTodoText(id, text) {
  const { error } = await supabase.from('todos').update({ text }).eq('id', id)

  if (error) console.error('Failed to update todo:', error.message)
  await loadTodos()
}

/** Write new sort_order values to the database after a drag reorder. */
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

// -----------------------------------------------------------------------------
// Rendering — rebuild the todo list in the DOM from the `todos` array
// -----------------------------------------------------------------------------

function render() {
  list.querySelectorAll('.todo-item').forEach((el) => el.remove())

  todos.forEach((todo) => {
    const isEditing = editingTodoId === todo.id
    const li = document.createElement('li')
    li.className = `todo-item${todo.is_complete ? ' todo-item--completed' : ''}${isEditing ? ' todo-item--editing' : ''}`
    li.dataset.id = String(todo.id)

    const textMarkup = isEditing
      ? `<input type="text" class="todo-text todo-text-input" value="${escapeHtml(todo.text)}" aria-label="Edit todo" />`
      : `<span class="todo-text">${escapeHtml(todo.text)}</span>`

    const editButtonClass = isEditing ? 'todo-confirm-button' : 'todo-edit-button'
    const editButtonLabel = isEditing ? 'Confirm edit' : 'Edit'
    const editButtonIcon = isEditing ? CONFIRM_ICON : EDIT_ICON

    li.innerHTML = `
      <div class="todo-reorder-zone">
        <button type="button" class="todo-drag-handle" aria-label="Reorder">⋮⋮</button>
        ${textMarkup}
      </div>
      <div class="todo-actions">
        <button type="button" class="todo-action-target todo-icon-button ${editButtonClass}" aria-label="${editButtonLabel}">${editButtonIcon}</button>
        <button type="button" class="todo-action-target todo-icon-button todo-delete-button" aria-label="Delete">${DELETE_ICON}</button>
        <label class="todo-action-target todo-checkbox-label">
          <input
            type="checkbox"
            class="todo-checkbox"
            ${todo.is_complete ? 'checked' : ''}
            aria-label="Mark complete"
          />
        </label>
      </div>
    `
    list.insertBefore(li, dropIndicator)
  })

  focusEditInput()
}

// -----------------------------------------------------------------------------
// Inline edit mode
// -----------------------------------------------------------------------------

/** Move the cursor to the end of the edit input after render. */
function focusEditInput() {
  if (!editingTodoId) return

  const editInput = list.querySelector(`[data-id="${editingTodoId}"] .todo-text-input`)
  if (!editInput) return

  editInput.focus()
  const length = editInput.value.length
  editInput.setSelectionRange(length, length)
}

/** Switch one todo into edit mode. */
function enterEditMode(id) {
  const todo = todos.find((t) => t.id === id)
  if (!todo) return

  editingTodoId = id
  editingOriginalText = todo.text
  render()
}

/** Discard edits and return to normal view. */
function cancelEdit() {
  resetEditState()
  render()
}

/** Save the edited text if it changed; otherwise just exit edit mode. */
async function confirmEdit(id) {
  const item = list.querySelector(`[data-id="${id}"]`)
  const editInput = item?.querySelector('.todo-text-input')
  const originalText = editingOriginalText

  resetEditState()

  if (!editInput) {
    render()
    return
  }

  const text = editInput.value.trim()
  if (!text || text === originalText) {
    render()
    return
  }

  await updateTodoText(id, text)
}

// -----------------------------------------------------------------------------
// Drag-and-drop reorder
// -----------------------------------------------------------------------------

/** Record each row's on-screen position (used for the post-drop slide animation). */
function captureItemPositions() {
  const positions = new Map()

  list.querySelectorAll('.todo-item').forEach((el) => {
    const rect = el.getBoundingClientRect()
    positions.set(Number(el.dataset.id), { top: rect.top, left: rect.left })
  })

  return positions
}

/** FLIP animation: rows visually slide from their old slots into their new ones. */
function animateReorder(firstPositions) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const items = [...list.querySelectorAll('.todo-item')]
  const moving = []

  items.forEach((el) => {
    const first = firstPositions.get(Number(el.dataset.id))
    if (!first) return

    const last = el.getBoundingClientRect()
    const deltaX = first.left - last.left
    const deltaY = first.top - last.top

    if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return

    moving.push(el)
    el.classList.add('todo-item--reorder-animate', 'todo-item--reorder-invert')
    el.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`
  })

  if (moving.length === 0) return

  // Two frames: apply the offset instantly, then animate back to the natural layout
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      moving.forEach((el) => {
        el.classList.remove('todo-item--reorder-invert')
        el.style.transform = ''
      })
    })
  })

  const cleanup = () => {
    moving.forEach((el) => {
      el.classList.remove('todo-item--reorder-animate', 'todo-item--reorder-invert')
      el.style.transform = ''
      el.style.willChange = ''
    })
  }

  const durationMs = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--duration-reorder'),
  ) * 1000

  window.setTimeout(cleanup, durationMs + 50)
}

/** Reorder the in-memory array, animate the shift, then persist to Supabase. */
function reorderTodos(fromIndex, insertIndex, firstPositions = null) {
  if (insertIndex === fromIndex || insertIndex === fromIndex + 1) return false

  const [moved] = todos.splice(fromIndex, 1)
  const toIndex = insertIndex > fromIndex ? insertIndex - 1 : insertIndex
  todos.splice(toIndex, 0, moved)

  todos.forEach((todo, index) => {
    todo.sort_order = index
  })

  render()

  if (firstPositions) {
    animateReorder(firstPositions)
  }

  persistSortOrder()
  return true
}

/** Figure out which list index the pointer is hovering over. */
function getInsertIndex(clientY) {
  const items = [...list.querySelectorAll('.todo-item')]
  if (items.length === 0) return 0

  for (let i = 0; i < items.length; i++) {
    const rect = items[i].getBoundingClientRect()
    if (clientY < rect.top + rect.height / 2) return i
  }

  return items.length
}

/** Position the drop indicator line at the target insert index. */
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

/** Short vibration on supported phones when a drag starts. */
function triggerReorderHaptic() {
  if (typeof navigator.vibrate === 'function') {
    navigator.vibrate(12)
  }
}

/** Clone the dragged row so it can follow the pointer. */
function createDragGhost(item) {
  const rect = item.getBoundingClientRect()
  const ghost = item.cloneNode(true)
  ghost.classList.add('todo-drag-ghost')
  ghost.setAttribute('aria-hidden', 'true')
  ghost.style.width = `${rect.width}px`
  document.body.appendChild(ghost)
  return { ghost, rect }
}

function positionDragGhost(ghost, clientX, clientY, offsetX, offsetY) {
  ghost.style.left = `${clientX - offsetX}px`
  ghost.style.top = `${clientY - offsetY}px`
}

/** Clean up drag visuals and optionally commit the reorder. */
function endDragSession(clientY, shouldReorder) {
  if (!dragState) return

  const { item, ghost, id, started } = dragState

  if (shouldReorder && started) {
    const fromIndex = todos.findIndex((t) => t.id === id)
    const insertIndex = dropInsertIndex ?? getInsertIndex(clientY)
    const firstPositions = captureItemPositions()

    item.classList.remove('todo-item--reorder-active', 'todo-item--dragging')
    ghost?.remove()
    clearDropIndicator()

    reorderTodos(fromIndex, insertIndex, firstPositions)
  } else {
    item.classList.remove('todo-item--reorder-active', 'todo-item--dragging')
    ghost?.remove()
    clearDropIndicator()
  }

  draggedTodoId = null
  dragState = null
}

// -----------------------------------------------------------------------------
// Event listeners — connect user actions to the functions above
// -----------------------------------------------------------------------------

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

showSignUpButton.addEventListener('click', () => {
  setAuthFeedback(signInFeedback, '')
  showAuthForm(signUpForm.hidden ? 'sign-up' : null)
})

showSignInButton.addEventListener('click', () => {
  setAuthFeedback(signUpFeedback, '')
  showAuthForm(signInForm.hidden ? 'sign-in' : null)
})

// Checkbox toggles — event delegation on the list
list.addEventListener('change', async (event) => {
  if (!event.target.matches('.todo-checkbox')) return
  const item = event.target.closest('.todo-item')
  const id = Number(item.dataset.id)
  await toggleTodo(id, event.target.checked)
})

// Edit / confirm / delete buttons — event delegation on the list
list.addEventListener('click', async (event) => {
  const editButton = event.target.closest('.todo-edit-button, .todo-confirm-button')
  if (editButton) {
    const item = editButton.closest('.todo-item')
    const id = Number(item.dataset.id)

    if (editingTodoId === id) {
      await confirmEdit(id)
      return
    }

    if (editingTodoId !== null) {
      await confirmEdit(editingTodoId)
    }

    enterEditMode(id)
    return
  }

  const deleteButton = event.target.closest('.todo-delete-button')
  if (!deleteButton) return
  const item = deleteButton.closest('.todo-item')
  const id = Number(item.dataset.id)
  await deleteTodo(id)
})

// Keyboard shortcuts while editing: Escape to cancel, Enter to confirm
list.addEventListener('keydown', async (event) => {
  if (!editingTodoId) return

  if (event.key === 'Escape') {
    cancelEdit()
    return
  }

  if (event.key === 'Enter' && event.target.matches('.todo-text-input')) {
    event.preventDefault()
    await confirmEdit(editingTodoId)
  }
})

// Pointer events for drag-to-reorder (works with mouse and touch)
list.addEventListener('pointerdown', (event) => {
  if (editingTodoId !== null) return

  const zone = event.target.closest('.todo-reorder-zone')
  if (!zone) return

  const item = zone.closest('.todo-item')
  if (!item) return

  event.preventDefault()
  zone.setPointerCapture(event.pointerId)
  triggerReorderHaptic()

  item.classList.add('todo-item--reorder-active')
  draggedTodoId = Number(item.dataset.id)

  dragState = {
    id: draggedTodoId,
    item,
    ghost: null,
    offsetX: 0,
    offsetY: 0,
    pointerId: event.pointerId,
    started: false,
    startX: event.clientX,
    startY: event.clientY,
  }
})

list.addEventListener('pointermove', (event) => {
  if (!dragState || event.pointerId !== dragState.pointerId) return

  const { item, startX, startY } = dragState

  if (!dragState.started) {
    const distance = Math.hypot(event.clientX - startX, event.clientY - startY)
    if (distance < DRAG_THRESHOLD) return

    const { ghost, rect } = createDragGhost(item)
    dragState.ghost = ghost
    dragState.offsetX = event.clientX - rect.left
    dragState.offsetY = event.clientY - rect.top
    dragState.started = true

    item.classList.add('todo-item--dragging')
    item.classList.remove('todo-item--reorder-active')
  }

  event.preventDefault()
  positionDragGhost(
    dragState.ghost,
    event.clientX,
    event.clientY,
    dragState.offsetX,
    dragState.offsetY,
  )

  dropInsertIndex = getInsertIndex(event.clientY)
  positionDropIndicator(dropInsertIndex)
})

list.addEventListener('pointerup', (event) => {
  if (!dragState || event.pointerId !== dragState.pointerId) return
  endDragSession(event.clientY, true)
})

list.addEventListener('pointercancel', (event) => {
  if (!dragState || event.pointerId !== dragState.pointerId) return
  endDragSession(event.clientY, false)
})

// -----------------------------------------------------------------------------
// App startup — listen for auth changes and load the first session
// -----------------------------------------------------------------------------

/** Run once: set up the user session and load their todos. */
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
  // Supabase fires this whenever login state changes (sign in, sign out, token refresh)
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

  // Fallback if INITIAL_SESSION already fired before our listener was registered
  if (!authBootstrapped) {
    const { data: { session } } = await supabase.auth.getSession()
    await bootstrapAuth(session?.user ?? null)
  }
}

init()
