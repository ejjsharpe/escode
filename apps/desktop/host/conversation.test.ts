import { expect, test } from 'vite-plus/test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConversationText } from '../src/conversation';

test('conversation renders Markdown and copyable code without executable provider markup', () => {
  const html = renderToStaticMarkup(React.createElement(ConversationText, { text:'## Result\n\n**Ready** [unsafe](javascript:alert%281%29)\n\n<script>alert(1)</script>\n\n```js\nconst answer = 42;\n```' }));
  expect(html).toContain('<h2>Result</h2>');
  expect(html).toContain('<strong>Ready</strong>');
  expect(html).toContain('Copy code');
  expect(html).toContain('const answer = 42;');
  expect(html).not.toContain('href="javascript:');
  expect(html).not.toContain('<script>');
});
