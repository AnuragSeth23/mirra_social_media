import { expect, test } from '@playwright/test';
import zlib from 'node:zlib';
import { PNG, api, createUser, signedInContext, unique } from './helpers';

// A solid-colour PNG of any size (so a "tall" and a "wide" photo can be told apart).
function solidPng(w, h, [r, g, b]) {
  const row = w * 3 + 1;
  const raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([r, g, b], y * row + 1 + x * 3);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const TALL = solidPng(90, 160, [200, 40, 90]);
const WIDE = solidPng(160, 90, [40, 120, 200]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]), Buffer.from('mp42'), Buffer.alloc(32)]);
const upload = async (token, type, data) => (await api('POST', '/media', token, undefined, { type, data })).json.data;

test.describe('Chat: photos, videos, shared posts, message requests, back button', () => {
  test('a stranger gets one message (a request); the composer then explains the wait instead of an error; accepting reopens it', async ({ browser }) => {
    const a = await createUser('ca');
    const b = await createUser('cb', 'Receiver Person');
    const chat = (await api('POST', `/messages/with/${b.id}`, a.token)).json.data.id;
    const { page, ctx } = await signedInContext(browser, a);
    await page.goto(`/messages/${chat}`);
    await page.getByRole('button', { name: 'Back to messages' }).waitFor(); // a back button inside the chat itself
    await page.getByLabel('Message', { exact: true }).fill('hello there');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.bubble.mine')).toContainText('hello there');
    await expect(page.locator('.request-note')).toContainText(/Message request sent/);
    await expect(page.locator('.chat-form')).toHaveCount(0);
    await api('POST', `/messages/${chat}/accept`, b.token);
    await expect(page.locator('.chat-form')).toBeVisible({ timeout: 10_000 }); // the 4-second refresh brings the composer back
    await page.getByRole('button', { name: 'Back to messages' }).click();
    await expect(page).toHaveURL(/\/messages$/);
    await ctx.close();
  });

  test('the receiver finds a stranger’s message under Requests, and can accept it into Chats or decline it', async ({ browser }) => {
    const a = await createUser('qa', 'Asker Person');
    const b = await createUser('qb');
    const c = await createUser('qc');
    const chats = {};
    for (const to of [b, c]) {
      chats[to.username] = (await api('POST', `/messages/with/${to.id}`, a.token)).json.data.id;
      await api('POST', `/messages/${chats[to.username]}`, a.token, { body: `hi ${to.username}` });
    }
    // accept
    const { page, ctx } = await signedInContext(browser, b);
    await page.goto('/messages');
    await expect(page.getByRole('tab', { name: /Requests \(1\)/ })).toBeVisible();
    await expect(page.locator('.chat-row')).toHaveCount(0); // not in Chats until accepted
    await page.getByRole('tab', { name: /Requests/ }).click();
    await page.getByRole('link', { name: /Asker Person/ }).click();
    await expect(page.locator('.bubble.theirs')).toContainText(`hi ${b.username}`);
    await page.getByRole('button', { name: 'Accept' }).click();
    await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Back to messages' }).click();
    await expect(page.locator('.chat-row')).toContainText('Asker Person'); // now in Chats
    await ctx.close();
    // decline: hidden for the receiver, and the sender can send nothing more (and is not told why)
    const { page: pc, ctx: cc } = await signedInContext(browser, c);
    await pc.goto('/messages');
    await pc.getByRole('tab', { name: /Requests/ }).click();
    await pc.getByRole('link', { name: /Asker Person/ }).click();
    await pc.getByRole('button', { name: 'Decline' }).click();
    await expect(pc).toHaveURL(/\/messages$/);
    await pc.getByRole('tab', { name: /Requests/ }).click();
    await expect(pc.getByText('No message requests')).toBeVisible();
    expect((await api('POST', `/messages/${chats[c.username]}`, a.token, { body: 'again' })).status).toBe(403);
    await cc.close();
  });

  test('send a photo and a video in a chat, with a preview before sending', async ({ browser }) => {
    const a = await createUser('cp');
    const b = await createUser('cq');
    const chat = (await api('POST', `/messages/with/${b.id}`, a.token)).json.data.id;
    await api('POST', `/messages/${chat}/accept`, b.token);
    await api('POST', `/messages/${chat}`, a.token, { body: 'first' }); // an ordinary conversation from here on
    const { page, ctx } = await signedInContext(browser, a);
    await page.goto(`/messages/${chat}`);
    await page.locator('input[type=file]').setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.locator('.attach-preview img')).toBeVisible();
    await page.getByLabel('Message', { exact: true }).fill('a photo');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.bubble img.msg-media')).toBeVisible();
    await expect(page.locator('.bubble').filter({ hasText: 'a photo' })).toBeVisible();
    await page.locator('input[type=file]').setInputFiles({ name: 'v.mp4', mimeType: 'video/mp4', buffer: MP4 });
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.bubble video.msg-media')).toBeVisible();
    await page.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.getByRole('alert')).toContainText(/JPG, PNG, WebP or GIF/);
    await ctx.close();
  });

  test('sharing a post or reel sends a card with a preview, not a pasted link', async ({ browser }) => {
    const a = await createUser('cs', 'Sharer Person');
    const b = await createUser('ct');
    const post = (await api('POST', '/posts', a.token, { caption: 'share me', audience: 'public' })).json.data;
    const chat = (await api('POST', `/messages/with/${b.id}`, a.token)).json.data.id;
    await api('POST', `/messages/${chat}/accept`, b.token);
    const { page, ctx } = await signedInContext(browser, a);
    await page.goto(`/post/${post.id}`);
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.getByLabel('Find a friend to send this to').fill(b.username);
    const row = page.getByRole('dialog', { name: 'Share' }).locator('li').filter({ hasText: b.username });
    await row.getByRole('button', { name: 'Send' }).click();
    await expect(row.getByRole('button', { name: /Sent/ })).toBeVisible();
    const { page: bp, ctx: bc } = await signedInContext(browser, b);
    await bp.goto(`/messages/${chat}`);
    const card = bp.locator('.share-card');
    await expect(card).toContainText(`@${a.username}`);
    await expect(card).toContainText('share me');
    await expect(bp.locator('.bubble a.msg-link')).toHaveCount(0);
    // when the author hides the post, the reader's card turns into a plain note and leaks nothing
    await api('PATCH', `/posts/${post.id}`, a.token, { audience: 'only_me' });
    await bp.reload();
    await expect(bp.locator('.share-card.gone')).toContainText(/no longer available/);
    await expect(bp.getByText('share me')).toHaveCount(0);
    await ctx.close();
    await bc.close();
  });
});

test.describe('Reels: several photos and videos, frame, buttons, back, refresh', () => {
  test('create a reel from several files: a photo defaults to 5 s, − / + change it, order and remove work', async ({ browser }) => {
    const u = await createUser('rc');
    const caption = unique('multi');
    const { page, ctx } = await signedInContext(browser, u);
    await page.getByRole('button', { name: 'Create' }).click();
    await page.getByRole('tab', { name: 'Reel' }).click();
    await page.locator('.modal input[type=file]').setInputFiles([
      { name: 'a.png', mimeType: 'image/png', buffer: TALL },
      { name: 'b.mp4', mimeType: 'video/mp4', buffer: MP4 },
      { name: 'c.png', mimeType: 'image/png', buffer: WIDE },
    ]);
    const rows = page.locator('.reel-items li');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText(/5 s/);
    await expect(rows.nth(1)).toContainText(/full length/);
    await rows.nth(0).getByRole('button', { name: 'Show for 1 second more' }).click();
    await rows.nth(0).getByRole('button', { name: 'Show for 1 second more' }).click();
    await rows.nth(2).getByRole('button', { name: 'Show for 1 second less' }).click();
    await expect(rows.nth(0)).toContainText('7 s');
    await expect(rows.nth(2)).toContainText('4 s');
    await rows.nth(2).getByRole('button', { name: 'Move earlier' }).click();
    await rows.nth(2).getByRole('button', { name: 'Remove from the reel' }).click(); // drops the video
    await page.getByLabel('Caption').fill(caption);
    await page.getByRole('button', { name: 'Share reel' }).click();
    await expect(page.getByText('Your reel is up')).toBeVisible();
    const mine = (await api('GET', '/posts/reels', u.token)).json.data.posts.find((p) => p.caption === caption);
    expect(mine.items.map((i) => [i.mediaType, i.durationMs])).toEqual([['image', 7000], ['image', 4000]]);
    await ctx.close();
  });

  test('a single photo can be a reel (5 s), and a photo time outside 1–30 s is refused by the server', async () => {
    const u = await createUser('r1');
    const key = (await upload(u.token, 'image/png', PNG)).key;
    const one = await api('POST', '/posts', u.token, { caption: 'one', kind: 'reel', mediaKey: key });
    expect(one.json.data.items[0].durationMs).toBe(5000);
    expect((await api('POST', '/posts', u.token, { caption: 'x', kind: 'reel', items: [{ key, durationMs: 31_000 }] })).status).toBe(422);
    expect((await api('POST', '/posts', u.token, { caption: 'x', kind: 'reel', items: [{ key, durationMs: 500 }] })).status).toBe(422);
    expect((await api('POST', '/posts', u.token, { caption: 'x', items: [{ key }, { key }] })).status).toBe(422); // only reels may hold several
  });

  test('reel player: frame takes the photo shape (nothing cropped), items advance with a progress bar each, buttons and back are visible, no caption', async ({ browser }) => {
    const author = await createUser('rp', 'Reel Author');
    const viewer = await createUser('rv');
    const k1 = (await upload(author.token, 'image/png', TALL)).key;
    const k2 = (await upload(author.token, 'image/png', WIDE)).key;
    const cap = unique('play');
    await api('POST', '/posts', author.token, { caption: cap, kind: 'reel', audience: 'public', items: [{ key: k1, durationMs: 1000 }, { key: k2, durationMs: 2000 }] });
    const { page, ctx } = await signedInContext(browser, viewer);
    await page.goto('/reels');
    const reel = page.locator('.reel', { has: page.locator(`img[alt^="${cap}"]`) });
    await expect(reel).toBeVisible();
    await expect(reel.locator('.reel-bars i')).toHaveCount(2);
    await expect(reel).toHaveAttribute('style', /aspect-ratio: 0\.5625/); // the frame follows the first photo's shape
    await expect(reel.locator('img.reel-photo')).toHaveCSS('object-fit', 'contain');
    await expect(reel.locator('.reel-bars i.done').first()).toBeVisible({ timeout: 4000 }); // after 1 s the first photo is done
    await expect(reel.locator('.reel-info p')).toHaveCount(0); // only the author under the picture
    await expect(reel.locator('.reel-author')).toContainText(author.username);
    // like / comment / share sit on a dark pad, inside the frame, and the back button is on the reel
    for (const name of ['Like', 'Comments', 'Share']) {
      const btn = reel.getByLabel(name, { exact: true });
      await expect(btn).toBeVisible();
      await expect(btn).toHaveCSS('background-color', /rgba\(0, 0, 0, 0\.55\)/);
    }
    const inside = await reel.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return ['.reel-actions', '.reel-info', '.reel-back'].every((s) => {
        const b = el.querySelector(s).getBoundingClientRect();
        return b.left >= r.left - 1 && b.right <= r.right + 1 && b.bottom <= r.bottom + 1 && b.top >= r.top - 1;
      });
    });
    expect(inside).toBe(true);
    await reel.getByRole('button', { name: 'Back' }).click();
    await expect(page).not.toHaveURL(/\/reels/);
    await ctx.close();
  });

  test('scrolling through many reels (photo reels, video reels, several pages) never crashes the page', async ({ browser }) => {
    const u = await createUser('rs');
    const key = (await upload(u.token, 'image/png', TALL)).key;
    for (let i = 0; i < 3; i++) await api('POST', '/posts', u.token, { caption: unique('scroll'), kind: 'reel', audience: 'public', items: [{ key }, { key: (await upload(u.token, 'image/png', WIDE)).key }] });
    const { page, ctx } = await signedInContext(browser, u);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/reels');
    await page.locator('.reel').first().waitFor();
    for (let i = 0; i < 14; i++) {
      await page.evaluate(() => {
        const main = document.querySelector('.reels');
        main.scrollTop += main.clientHeight; // next reel; near the end the next page is fetched
      });
      await page.waitForTimeout(350);
      await expect(page.getByRole('heading', { name: 'Something went wrong' })).toHaveCount(0);
    }
    expect(errors).toEqual([]);
    expect(await page.locator('.reel').count()).toBeGreaterThan(6); // more than the first page was loaded
    await ctx.close();
  });

  test('the SocialAmbak logo is never underlined and goes to Home', async ({ browser }) => {
    const u = await createUser('lg');
    const { page, ctx } = await signedInContext(browser, u);
    await page.goto('/messages');
    const logo = page.getByRole('link', { name: 'SocialAmbak home' });
    await logo.hover();
    await expect(logo).toHaveCSS('text-decoration-line', 'none');
    await logo.click();
    await expect(page).toHaveURL(/\/$/);
    await ctx.close();
  });

  test('double-click refreshes Home and Reels (photos, text, buttons...), but not text boxes or pop-ups', async ({ browser }) => {
    const u = await createUser('dc');
    const key = (await upload(u.token, 'image/png', PNG)).key;
    await api('POST', '/posts', u.token, { caption: unique('dc'), mediaKey: key, audience: 'public' });
    await api('POST', '/posts', u.token, { caption: unique('dr'), kind: 'reel', audience: 'public', items: [{ key, durationMs: 3000 }] });
    const { page, ctx } = await signedInContext(browser, u);
    const reloads = async (path, selector) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const el = page.locator(selector).first();
      await el.waitFor();
      await page.evaluate(() => { window.__marker = 1; });
      await el.dblclick({ force: true });
      await page.waitForFunction(() => window.__marker === undefined, null, { timeout: 8000 });
    };
    await reloads('/', '.post-img');
    await reloads('/', '.post');
    await reloads('/', '.app-main');
    await reloads('/reels', '.reel img.reel-photo, .reel video');
    await reloads('/reels', '.reel-actions button');
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      window.__marker = 1;
      const input = document.createElement('input');
      document.body.append(input);
      input.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      document.body.append(dialog);
      dialog.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => window.__marker)).toBe(1);
    await ctx.close();
  });
});
