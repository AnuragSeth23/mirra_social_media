import { expect, test } from '@playwright/test';
import { api, createUser, openCreate, png, signedInContext, trackErrors, unique } from './helpers';

test.describe('Posts, likes, comments, replies, saves, hashtags', () => {
  test('home has no always-on post box; the + button opens it as a pop-up', async ({ browser }) => {
    const u = await createUser('pb');
    const { page, ctx } = await signedInContext(browser, u);
    await expect(page.locator('.composer')).toHaveCount(0);
    await openCreate(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal')).toHaveCount(0);
    await page.getByRole('button', { name: 'Add to your story' }).click();
    await expect(page.locator('.modal .seg button.on')).toHaveText('Story');
    await ctx.close();
  });

  test('create a text post, edit it, like it, save it, delete it', async ({ browser }) => {
    const u = await createUser('tp');
    const { page, ctx } = await signedInContext(browser, u);
    const errors = trackErrors(page);
    const text = `Hello ${unique('w')}`;
    await openCreate(page);
    await page.getByLabel('Caption').fill(text);
    await page.locator('.modal .composer').getByRole('button', { name: 'Share', exact: true }).click();
    await expect(page.locator('.modal')).toHaveCount(0, { timeout: 6000 });
    const card = page.locator('.post').filter({ hasText: text });
    await expect(card).toBeVisible();

    // like / unlike
    await card.getByRole('button', { name: 'Like' }).click();
    await expect(card.getByRole('button', { name: 'Unlike' })).toContainText('1');
    await card.getByRole('button', { name: 'Unlike' }).click();
    await expect(card.getByRole('button', { name: 'Like' })).toContainText('0');

    // save
    await card.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Unsave' })).toBeVisible();

    // edit caption
    await card.getByRole('button', { name: 'More options' }).click();
    await card.getByRole('menuitem', { name: 'Edit caption' }).click();
    await card.getByLabel('Edit caption').fill(`${text} (edited)`);
    await card.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.post').filter({ hasText: '(edited)' })).toBeVisible();

    // delete
    page.once('dialog', (d) => d.accept());
    await page.locator('.post').filter({ hasText: '(edited)' }).getByRole('button', { name: 'More options' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(page.locator('.post').filter({ hasText: text })).toHaveCount(0);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('empty post cannot be shared', async ({ browser }) => {
    const u = await createUser('ep');
    const { page, ctx } = await signedInContext(browser, u);
    await openCreate(page);
    await expect(page.locator('.modal .composer').getByRole('button', { name: 'Share', exact: true })).toBeDisabled();
    await ctx.close();
  });

  test('photo upload: wrong file type and oversize are refused, a real photo posts', async ({ browser }) => {
    const u = await createUser('ph');
    const { page, ctx } = await signedInContext(browser, u);
    await openCreate(page);
    const input = page.locator('.modal input[type=file]');
    await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.getByRole('alert').filter({ hasText: /JPG, PNG, WebP or GIF/i })).toBeVisible();
    await input.setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 10) });
    await expect(page.getByRole('alert').filter({ hasText: /5 MB/i })).toBeVisible();
    await input.setInputFiles(png());
    await expect(page.getByAltText('Selected photo preview')).toBeVisible();
    await page.getByLabel('Caption').fill('A pixel');
    await page.locator('.modal .composer').getByRole('button', { name: 'Share', exact: true }).click();
    await expect(page.locator('.post').filter({ hasText: 'A pixel' }).locator('img.post-img')).toBeVisible();
    await ctx.close();
  });

  test('comments, replies (one level), delete, and counts', async ({ browser }) => {
    const author = await createUser('ca');
    const other = await createUser('cb');
    const p = await api('POST', '/posts', author.token, { caption: 'discuss this' });
    const { page, ctx } = await signedInContext(browser, other);
    await page.goto(`/post/${p.json.data.id}`);
    const card = page.locator('.post');
    await card.getByLabel('Add a comment').fill('first comment');
    await card.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(card.getByText('first comment')).toBeVisible();
    await card.getByRole('button', { name: 'Reply', exact: true }).first().click();
    await expect(card.getByText(/Replying to/)).toBeVisible();
    await card.getByLabel('Add a comment').fill('a reply');
    await card.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(card.locator('.replies').getByText('a reply')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Comments' })).toContainText('2');
    page.once('dialog', (d) => d.accept());
    await card.getByRole('button', { name: 'Delete', exact: true }).first().click();
    await expect(card.getByText('first comment')).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Comments' })).toContainText('0');
    await ctx.close();
  });

  test('hashtags and mentions in captions are links; the tag page lists the post', async ({ browser }) => {
    const u = await createUser('ht');
    const tag = unique('tg');
    await api('POST', '/posts', u.token, { caption: `Sunset #${tag} with @${u.username}. Mail a@b.com` });
    const { page, ctx } = await signedInContext(browser, u);
    await page
      .locator('.post')
      .filter({ hasText: `#${tag}` })
      .getByRole('link', { name: `#${tag}` })
      .click();
    await expect(page).toHaveURL(new RegExp(`/tag/${tag}`));
    await expect(page.getByRole('heading', { name: `#${tag}` })).toBeVisible();
    await expect(page.locator('.grid .tile')).toHaveCount(1);
    await ctx.close();
  });

  test('share: the pop-up copies the link with a visible answer and offers other apps', async ({ browser }) => {
    const u = await createUser('sh');
    const p = await api('POST', '/posts', u.token, { caption: 'share me please' });
    const { page, ctx } = await signedInContext(browser, u);
    await page.goto(`/post/${p.json.data.id}`);
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Share' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /Copy link/ }).click();
    await expect(dialog.getByRole('button', { name: /Copied/ })).toBeVisible();
    await expect(dialog.getByRole('status')).toContainText('Link copied');
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toContain(`/post/${p.json.data.id}`);
    for (const name of ['WhatsApp', 'Facebook', 'X', 'Telegram', 'Email']) await expect(dialog.getByRole('link', { name })).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', /wa\.me/);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Share', exact: true })).toContainText('1'); // the counter went up once
    await ctx.close();
  });

  test('share: send a post to a friend inside SocialAmbak and it shows up as a clickable link in the chat', async ({ browser }) => {
    const sender = await createUser('ss');
    const friend = await createUser('sf', 'Friendly Person');
    const p = await api('POST', '/posts', sender.token, { caption: 'look at this' });
    const { page, ctx } = await signedInContext(browser, sender);
    await page.goto(`/post/${p.json.data.id}`);
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.getByLabel('Find a friend to send this to').fill(friend.username);
    const row = page.getByRole('dialog', { name: 'Share' }).locator('li').filter({ hasText: friend.username });
    await row.getByRole('button', { name: 'Send' }).click();
    await expect(row.getByRole('button', { name: /Sent/ })).toBeVisible();
    const { page: fp, ctx: fc } = await signedInContext(browser, friend);
    await fp.goto('/messages');
    await fp.getByRole('link', { name: new RegExp(sender.fullName) }).click();
    const link = fp.locator('.bubble a.msg-link');
    await expect(link).toBeVisible();
    await link.click();
    await expect(fp).toHaveURL(new RegExp(`/post/${p.json.data.id}`));
    await ctx.close();
    await fc.close();
  });

  test('infinite feed: "Load more" brings older posts', async ({ browser }) => {
    const u = await createUser('lm');
    const tag = unique('bk'); // unique captions: public posts from earlier runs can appear under "Suggested for you"
    for (let i = 0; i < 12; i++) await api('POST', '/posts', u.token, { caption: `${tag} item ${i}` });
    const { page, ctx } = await signedInContext(browser, u);
    const mine = page.locator('.post').filter({ hasText: new RegExp(`${tag} item \\d+`) });
    await expect(mine).toHaveCount(10);
    await expect(page.getByRole('heading', { name: 'Suggested for you' })).toHaveCount(0); // not until the followed feed has ended
    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(mine).toHaveCount(12);
    await ctx.close();
  });

  test('a brand-new user sees public posts as "Suggested for you" (never private ones), and following moves them to the feed', async ({ browser }) => {
    const author = await createUser('dp', 'Public Author');
    const hidden = await createUser('dh', 'Private Author');
    await api('PATCH', '/users/me', hidden.token, { isPrivate: true });
    const text = `Welcome post ${unique('s')}`;
    await api('POST', '/posts', author.token, { caption: text });
    await api('POST', '/posts', hidden.token, { caption: 'private secret post' });
    const newcomer = await createUser('nw');
    const { page, ctx } = await signedInContext(browser, newcomer);
    await expect(page.getByRole('heading', { name: 'Suggested for you' })).toBeVisible();
    await expect(page.getByText(/don.t follow anyone yet/i)).toBeVisible();
    await expect(page.locator('.post').filter({ hasText: text })).toBeVisible();
    await expect(page.locator('.post').filter({ hasText: 'private secret post' })).toHaveCount(0);

    await page.goto(`/u/${author.username}`);
    await page.getByRole('button', { name: 'Follow', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Following', exact: true })).toBeVisible();
    await page.goto('/');
    // the followed author's post is now in the main feed, above any "Suggested for you" section
    const mainPost = page.locator('.post').filter({ hasText: text });
    await expect(mainPost).toHaveCount(1);
    const suggestedHeading = page.getByRole('heading', { name: 'Suggested for you' });
    if (await suggestedHeading.count()) {
      const postY = (await mainPost.boundingBox()).y;
      const headingY = (await suggestedHeading.boundingBox()).y;
      expect(postY).toBeLessThan(headingY);
    }
    await ctx.close();
  });

  test('a brand-new user sees friendly empty states', async ({ browser }) => {
    const u = await createUser('nu');
    const { page, ctx } = await signedInContext(browser, u);
    // nothing followed yet: either public posts are suggested, or (on an empty database) the quiet message shows
    await expect(page.getByRole('heading', { name: /suggested for you|feed is quiet/i })).toBeVisible();
    await page.goto('/notifications');
    await expect(page.getByRole('heading', { name: /nothing yet/i })).toBeVisible();
    await page.goto('/messages');
    await expect(page.getByRole('heading', { name: /no messages yet/i })).toBeVisible();
    await page.goto('/reels');
    await ctx.close();
  });
});
