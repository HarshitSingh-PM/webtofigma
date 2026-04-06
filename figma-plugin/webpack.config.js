const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const HtmlInlineScriptPlugin = require('html-inline-script-webpack-plugin');

module.exports = [
  // Plugin code (runs in Figma sandbox — NO optional chaining support)
  {
    entry: './src/plugin/index.ts',
    target: ['web', 'es2017'],
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'plugin.js',
      environment: {
        arrowFunction: true,
        asyncFunction: true,
        destructuring: true,
        forOf: true,
        optionalChaining: false,   // Figma sandbox doesn't support ?.
      },
    },
    module: {
      rules: [{ test: /\.tsx?$/, use: 'ts-loader', exclude: /node_modules/ }],
    },
    resolve: { extensions: ['.ts', '.tsx', '.js'] },
  },
  // UI code (runs in iframe — modern browser, safe to use modern syntax)
  {
    entry: './src/ui/index.ts',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'ui.js',
    },
    module: {
      rules: [
        { test: /\.tsx?$/, use: 'ts-loader', exclude: /node_modules/ },
        { test: /\.css$/, use: ['style-loader', 'css-loader'] },
      ],
    },
    resolve: { extensions: ['.ts', '.tsx', '.js'] },
    plugins: [
      new HtmlWebpackPlugin({
        template: './src/ui/ui.html',
        filename: 'ui.html',
        inject: 'body',
        cache: false,
      }),
      new HtmlInlineScriptPlugin(),
    ],
  },
];
