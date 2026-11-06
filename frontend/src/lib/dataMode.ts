/**
 * Demo or live data, chosen on the start screen each time the app loads.
 * Demo builds plans in the browser from recorded routes plus weather
 * scenarios, so every state can be explored without driving or waiting for
 * weather. Live calls the Django API.
 */
export type DataMode = 'demo' | 'live'

let mode: DataMode = import.meta.env.VITE_API_MOCK === '1' ? 'demo' : 'live'

export const getDataMode = () => mode
export const setDataMode = (m: DataMode) => {
  mode = m
}
