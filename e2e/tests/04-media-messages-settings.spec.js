import { expect, test } from '@playwright/test';
import { api, createUser, openCreate, png, signedInContext, trackErrors, uiLogin, PASSWORD } from './helpers';

test.describe('Camera, stories, reels, avatar', () => {
  test('camera: take a photo and post it', async ({ browser }) => {
    const u = await createUser('cm');
    const { page, ctx } = await signedInContext(browser, u);
    const errors = trackErrors(page);
    await openCreate(page);
    await page.locator('.modal').getByRole('button', { name: 'Camera', exact: true }).click();
    await page.getByRole('button', { name: 'Take photo' }).click({ timeout: 15000 }); // enabled only once the camera is ready
    await expect(page.getByAltText('Selected photo preview')).toBeVisible();
    await page.getByLabel('Caption').fill('Photo from the SocialAmbak camera');
    await page.locator('.modal .composer').getByRole('button', { name: 'Share', exact: true }).click();
    await expect(page.locator('.post').filter({ hasText: 'Photo from the SocialAmbak camera' }).locator('img.post-img')).toBeVisible();
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('camera: record a video, it becomes a reel, and plays in Reels', async ({ browser }) => {
    const u = await createUser('rl');
    const { page, ctx } = await signedInContext(browser, u);
    await openCreate(page);
    await page.locator('.modal').getByRole('button', { name: 'Camera', exact: true }).click();
    await page.getByRole('button', { name: 'Record video' }).click({ timeout: 15000 });
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: 'Stop recording' }).click();
    await expect(page.locator('.modal .reel-items li video')).toBeVisible(); // a reel lists its photos/videos
    await expect(page.locator('.modal .seg button.on')).toHaveText('Reel'); // a video defaults to a reel
    await page.getByLabel('Caption').fill('My reel');
    await page
      .locator('.modal .composer')
      .getByRole('button', { name: /Share reel/ })
      .click();
    await expect(page.locator('.modal')).toHaveCount(0, { timeout: 8000 });
    // the recorded clip is stored as a reel with one video (checked through the API, so other people's reels cannot confuse the test)
    const mine = (await api('GET', `/posts/by/${u.username}`, u.token)).json.data.posts[0];
    expect(mine.kind).toBe('reel');
    expect(mine.items.map((i) => i.mediaType)).toEqual(['video']);
    expect(mine.mediaUrl).toMatch(/\/api\/v1\/media\/.+\.(webm|mp4)/);
    await page.goto('/reels');
    await expect(page.locator('.reel').first()).toBeVisible();
    await ctx.close();
  });

  test('closing the camera while recording does not attach a clip', async ({ browser }) => {
    const u = await createUser('cc');
    const { page, ctx } = await signedInContext(browser, u);
    await openCreate(page);
    await page.locator('.modal').getByRole('button', { name: 'Camera', exact: true }).click();
    await page.getByRole('button', { name: 'Record video' }).click({ timeout: 15000 });
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Close camera' }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('.modal .composer-preview')).toHaveCount(0);
    await ctx.close();
  });

  test('stories: post, view (viewer counts), delete; followers see it, strangers do not', async ({ browser }) => {
    const a = await createUser('sa');
    const b = await createUser('sb');
    const c = await createUser('sc');
    await api('PUT', `/users/${a.id}/follow`, b.token);
    const { page: pa, ctx: ca } = await signedInContext(browser, a);
    await pa.getByRole('button', { name: 'Add to your story' }).click();
    await pa.locator('.modal input[type=file]').setInputFiles(png('story.png'));
    await pa
      .locator('.modal .composer')
      .getByRole('button', { name: /Share story/ })
      .click();
    await expect(pa.locator('.modal')).toHaveCount(0, { timeout: 8000 });
    await expect(pa.getByRole('button', { name: 'Your story, new' })).toBeVisible();

    const { page: pb, ctx: cb } = await signedInContext(browser, b);
    await pb.getByRole('button', { name: new RegExp(`${a.username}.s story, new`) }).click();
    await expect(pb.locator('.story-view')).toBeVisible();
    await pb.keyboard.press('Escape');
    await expect(pb.getByRole('button', { name: new RegExp(`${a.username}.s story, seen`) })).toBeVisible();

    const { page: pc, ctx: cc } = await signedInContext(browser, c);
    await expect(pc.locator('.story-chip').filter({ hasText: a.username })).toHaveCount(0);

    await pa.reload();
    await pa
      .getByRole('button', { name: 'Your story, new' })
      .click()
      .catch(() =>
        pa
          .getByRole('button', { name: /Your story/ })
          .first()
          .click(),
      );
    await expect(pa.locator('.story-views')).toContainText('1 view');
    pa.once('dialog', (d) => d.accept());
    await pa.locator('.story-head').getByRole('button', { name: 'Delete' }).click();
    await expect(pa.locator('.story-view')).toHaveCount(0);
    await ca.close();
    await cb.close();
    await cc.close();
  });
});

test.describe('Messages', () => {
  test('two people chat; unread badge appears, clears on open', async ({ browser }) => {
    const a = await createUser('ma', 'Mia');
    const b = await createUser('mb', 'Ben');
    const { page: pa, ctx: ca } = await signedInContext(browser, a);
    const { page: pb, ctx: cb } = await signedInContext(browser, b);

    await pa.goto(`/u/${b.username}`);
    await pa.getByRole('button', { name: 'Message' }).click();
    await expect(pa).toHaveURL(/\/messages\/.+/);
    await pa.getByRole('textbox', { name: 'Message' }).fill('Hi Ben, are you there?');
    await pa.getByRole('button', { name: 'Send' }).click();
    await expect(pa.getByText('Hi Ben, are you there?')).toBeVisible();

    // Mia is not Ben's friend, so her first message waits in his Requests tab; replying accepts it.
    await pb.goto('/messages');
    await pb.getByRole('tab', { name: /Requests/ }).click();
    await expect(pb.getByText('Hi Ben, are you there?')).toBeVisible();
    await expect(pb.locator('.chat-row .dot')).toHaveText('1');
    await pb.getByRole('link', { name: /Mia/ }).click();
    await expect(pb.getByRole('button', { name: 'Accept' })).toBeVisible();
    await pb.getByRole('textbox', { name: 'Message' }).fill('Yes Mia!');
    await pb.getByRole('button', { name: 'Send' }).click();
    await expect(pa.getByText('Yes Mia!')).toBeVisible({ timeout: 10000 }); // arrives by polling
    await pb.goto('/messages');
    await expect(pb.locator('.chat-row .dot')).toHaveCount(0);
    await ca.close();
    await cb.close();
  });

  test('"Message" explains why when messages are closed', async ({ browser }) => {
    const a = await createUser('mc');
    const b = await createUser('md');
    await api('PATCH', '/account/settings', b.token, { messagesFrom: 'nobody' });
    const { page, ctx } = await signedInContext(browser, a);
    await page.goto(`/u/${b.username}`);
    await page.getByRole('button', { name: 'Message' }).click();
    await expect(page.getByRole('alert')).toContainText(/accepting messages/i);
    await ctx.close();
  });
});

test.describe('Settings and account', () => {
  test('edit profile: name, bio, website, avatar; unsafe website links are refused', async ({ browser }) => {
    const u = await createUser('se', 'Old Name');
    const { page, ctx } = await signedInContext(browser, u);
    await page.goto('/settings');
    await page.getByLabel('Name').fill('New Name');
    await page.getByLabel('Bio').fill('Hello from the tests');
    await page.getByLabel('Website').fill('javascript:alert(1)');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(/starting with http/i)).toBeVisible();
    await page.getByLabel('Website').fill('https://example.com');
    await page.locator('input[type=file]').setInputFiles(png('me.png'));
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
    await page.goto(`/u/${u.username}`);
    await expect(page.getByRole('heading', { name: 'New Name' })).toBeVisible();
    await expect(page.getByText('Hello from the tests')).toBeVisible();
    await expect(page.getByRole('link', { name: 'example.com' })).toHaveAttribute('rel', /noopener/);
    await expect(page.locator('img.avatar-sm').first()).toBeVisible();
    await ctx.close();
  });

  test('change the profile photo from the profile page: choose, camera, bad file, remove', async ({ browser }) => {
    const u = await createUser('av', 'Photo Person');
    const { page, ctx } = await signedInContext(browser, u);
    await page.goto(`/u/${u.username}`);
    const avatar = page.locator('.profile-head .avatar-btn');
    await expect(avatar.locator('img')).toHaveCount(0); // starts with the letter

    // choose a file
    await page.getByRole('button', { name: 'Change profile photo' }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: 'Choose a photo' }).click();
    await (await chooser).setFiles(png('face.png'));
    await expect(avatar.locator('img')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Your profile' }).locator('img')).toBeVisible(); // top bar updates too

    // a text file is refused and the photo stays
    await page.getByRole('button', { name: 'Change profile photo' }).click();
    const chooser2 = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: 'Choose a photo' }).click();
    await (await chooser2).setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
    await expect(page.getByRole('alert').filter({ hasText: /JPG, PNG, WebP or GIF/i })).toBeVisible();
    await expect(avatar.locator('img')).toBeVisible();

    // take one with the camera
    await page.getByRole('button', { name: 'Change profile photo' }).click();
    await page.getByRole('menuitem', { name: 'Remove current photo' }).click();
    await expect(avatar.locator('img')).toHaveCount(0);
    await page.getByRole('button', { name: 'Change profile photo' }).click();
    await page.getByRole('menuitem', { name: 'Take a photo' }).click();
    await page.getByRole('button', { name: 'Take photo' }).click({ timeout: 15000 });
    await expect(avatar.locator('img')).toBeVisible();

    // it survives a reload, and other people see it
    await page.reload();
    await expect(page.locator('.profile-head .avatar-btn img')).toBeVisible();
    const other = await createUser('av2');
    const { page: p2, ctx: c2 } = await signedInContext(browser, other);
    await p2.goto(`/u/${u.username}`);
    await expect(p2.locator('.profile-head img.avatar-sm')).toBeVisible();
    await expect(p2.getByRole('button', { name: 'Change profile photo' })).toHaveCount(0); // only the owner can change it
    await c2.close();
    await ctx.close();
  });

  test('change password, then deactivate and sign back in', async ({ browser }) => {
    const u = await createUser('pw');
    const { page, ctx } = await signedInContext(browser, u);
    await page.goto('/settings');
    await page.getByLabel('Current password').fill('wrong-password-1');
    await page.getByLabel('New password').fill('brandnew88');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /not right/i })).toBeVisible();
    await page.getByLabel('Current password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText(/password changed/i)).toBeVisible();

    await page.getByRole('button', { name: /Deactivate my account/ }).click();
    await page.getByLabel('Password', { exact: true }).fill('brandnew88');
    await page.getByRole('button', { name: 'Deactivate' }).click();
    await expect(page).toHaveURL(/signin/);
    await uiLogin(page, u.username, 'brandnew88');
    await ctx.close();
  });

  test('privacy and notification preferences persist', async ({ browser }) => {
    const u = await createUser('pf');
    const { page, ctx } = await signedInContext(browser, u);
    await page.goto('/settings');
    await page.getByLabel('Who can start a chat with you').selectOption('following');
    await page.getByLabel('Likes on my posts').uncheck();
    await page.reload();
    await expect(page.getByLabel('Who can start a chat with you')).toHaveValue('following');
    await expect(page.getByLabel('Likes on my posts')).not.toBeChecked();
    await ctx.close();
  });

  test('signing out everywhere signs this browser out, and another signed-in browser is sent to sign in', async ({ browser }) => {
    const u = await createUser('lo');
    const { page: p1, ctx: c1 } = await signedInContext(browser, u);
    const { page: p2, ctx: c2 } = await signedInContext(browser, u);
    await p1.goto('/settings');
    await p1.getByRole('button', { name: 'Log out of all devices' }).click();
    await expect(p1).toHaveURL(/signin/);
    await p2.goto('/notifications'); // its session was revoked: the app must notice and go to sign-in
    await expect(p2).toHaveURL(/signin/, { timeout: 15000 });
    await c1.close();
    await c2.close();
  });
});

test.describe('Responsive and accessibility basics', () => {
  test('mobile: bottom tab bar, no horizontal scroll, profile card fits', async ({ browser }) => {
    const u = await createUser('mo');
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true });
    const page = await ctx.newPage();
    await uiLogin(page, u.username);
    const nav = await page.locator('.mainnav').boundingBox();
    expect(nav.y).toBeGreaterThan(600); // pinned to the bottom, not the top
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
    await page.getByRole('button', { name: 'Your profile' }).click();
    const card = await page.getByRole('dialog', { name: 'Your profile' }).boundingBox();
    expect(card.x).toBeGreaterThanOrEqual(0);
    expect(card.x + card.width).toBeLessThanOrEqual(390);
    await ctx.close();
  });

  test('keyboard: every nav item is reachable and has an accessible name; dark mode toggles', async ({ browser }) => {
    const u = await createUser('kb');
    const { page, ctx } = await signedInContext(browser, u);
    for (const name of ['Home', 'Search', 'Create', 'Reels', 'Activity', 'Messages', 'Profile']) {
      await expect(page.getByRole('navigation', { name: 'Main' }).getByRole(name === 'Create' ? 'button' : 'link', { name })).toBeVisible();
    }
    const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await page.getByRole('button', { name: /Change theme/ }).click();
    const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(after).not.toBe(before);
    await ctx.close();
  });

  test('country dropdown on sign-up is readable in dark mode', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto('/signup');
    const color = await page
      .locator('#country option')
      .first()
      .evaluate((el) => getComputedStyle(el).color);
    const bg = await page
      .locator('#country option')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(color).not.toBe(bg);
    await ctx.close();
  });
});
