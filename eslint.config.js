import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import react from 'eslint-plugin-react'
import { defineConfig, globalIgnores } from 'eslint/config'

/**
 * 说明：
 *  - 前端 src/ 使用浏览器全局；后端 backend/ 与脚本 tools/、shared/ 使用 Node 全局。
 *  - react-hooks v7 自带的 React Compiler 规则（set-state-in-effect / purity）对
 *    「在 effect 里发请求然后 setState」这类主流写法过于严格，这里降级为 warning：
 *    它们提示的是优化机会而不是错误；真正的错误（未使用变量、未定义变量）仍是 error。
 *  - react-refresh/only-export-components 只是热更新体验提示，同样降级为 warning。
 */
export default defineConfig([
  globalIgnores(['dist', 'node_modules', 'backend/data']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: { react },
    rules: {
      // 让 no-unused-vars 认识 JSX 里使用的组件变量（否则 <Icon /> 会被误判为未使用）
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'off',
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^[A-Z_]',
        argsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-refresh/only-export-components': 'warn',
    },
  },
  {
    files: ['backend/**/*.js', 'tools/**/*.{js,mjs}', 'shared/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
])
