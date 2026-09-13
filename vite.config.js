import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * 说明：
 *  - 未设置 base，产物引用 /assets/... 绝对路径 —— 站点必须部署在域名根路径。
 *  - dev 与 preview 都把 /api 代理到后端 3000 端口，保证前后端同源
 *    （生产环境由 Nginx 承担同样的反代，见 deploy/nginx.conf.sample）。
 *  - preview 用于在本地以「生产产物」跑一遍冒烟测试。
 */
const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:3000',
    changeOrigin: true,
  },
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: apiProxy,
  },
  preview: {
    port: 4173,
    proxy: apiProxy,
  },
})
