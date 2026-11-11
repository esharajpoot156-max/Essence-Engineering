const API = (import.meta.env.VITE_API_URL || '') + '/api'

export const getToken = () => localStorage.getItem('token')
export const setToken = t => (t ? localStorage.setItem('token', t) : localStorage.removeItem('token'))
export async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() }, body: body && JSON.stringify(body) })
  const data = await r.json().catch(() => ({}))
  if (r.status === 401) { setToken(null); location.href = '/' }
  if (!r.ok) throw new Error(data.error || 'Something went wrong')
  return data
}