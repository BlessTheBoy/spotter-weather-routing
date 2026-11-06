import { createTheme } from '@mui/material/styles'

// Spotter's palette: teal family on near-black.
export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#20B2AA', dark: '#008080', light: '#40E0D0', contrastText: '#041014' },
    background: { default: '#0D1116', paper: '#131A20' },
    divider: 'rgba(255,255,255,0.08)',
    text: { primary: '#E8EEF2', secondary: '#93A3AE' },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: '"DM Sans", system-ui, sans-serif',
    h1: { fontSize: '1.05rem', fontWeight: 700, letterSpacing: 0.2 },
    subtitle2: { fontWeight: 700 },
    overline: { fontWeight: 700, letterSpacing: 1.2, lineHeight: 2 },
  },
  components: {
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiButton: { styleOverrides: { root: { textTransform: 'none', fontWeight: 700 } } },
    MuiToggleButton: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600 } } },
    MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
  },
})
