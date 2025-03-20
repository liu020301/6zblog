import { defineConfig } from 'vitepress'
import { set_sidebar } from './utils/auto_sidebar.mjs'
// https://vitepress.dev/reference/site-config
export default defineConfig({
  base: "/6zblog/",
  head: [["link", {rel: "icon", href: "/6zBlog/blog_icon.svg"}]],
  title: "6z Blog",
  description: "A VitePress Site",
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    outlineTitle: '目录',
    outline: [1, 6],
    logo: '/blog_icon.svg',
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Examples', items:[
        { text: 'Markdown Examples', link: '/markdown-examples' },
        { text: 'Runtime API Examples', link: '/api-examples' }
      ] },
      { text: "碎碎念", link: '/life'},
      { text: "关于我", link: "/about-me"},
    ],

    // sidebar: [
    //   {
    //     text: 'Examples',
    //     items: [
    //       { text: 'Markdown Examples', link: '/markdown-examples' },
    //       { text: 'Runtime API Examples', link: '/api-examples' }
    //     ]
    //   }
    // ],

    sidebar: {
      "/life": set_sidebar("/life"),
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/liu020301' }
    ],

    footer: {
      copyright: "Copyright© 2025 Zehao Liu",
    },
    
       // 设置搜索框的样式
       search: {
        provider: "local",
        options: {
          translations: {
            button: {
              buttonText: "搜索文档",
              buttonAriaLabel: "搜索文档",
            },
            modal: {
              noResultsText: "无法找到相关结果",
              resetButtonTitle: "清除查询条件",
              footer: {
                selectText: "选择",
                navigateText: "切换",
              },
            },
          },
        },
      },

  }
})
