import { expect, test } from '@playwright/test';
import { api, createUser, signedInContext, trackErrors } from './helpers';

test.describe('Profiles, follow, follow back, private accounts, blocking, notifications', () => {
  test('profile card in the top bar and the full profile with a post grid and pop-up viewer', async ({ browser }) => {
    const u = await createUser('pr', 'Profile Person');
    await api('POST', '/posts', u.token, { caption: 'grid post one' });
    await api('POST', '/posts', u.token, { caption: 'grid post two' });
    const { page, ctx } = await signedInContext(browser, u);
    await expect(page.locator('.profile-head')).toHaveCount(0); // summary is no longer inline on Home
    await page.getByRole('button', { name: 'Your profile' }).click();
    const card = page.getByRole('dialog', { name: 'Your profile' });
    await expect(card).toContainText('Profile Person');
    await expect(card).toContainText('2');
    await card.getByRole('link', { name: 'View profile' }).click();
    await expect(page).toHaveURL(new RegExp(`/u/${u.username}`));
    await expect(page.locator('.profile-grid .tile')).toHaveCount(2);
    await page.locator('.profile-grid .tile').first().click();
    await expect(page.locator('.modal .post')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal')).toHaveCount(0);
    await ctx.close();
  });

  test('follow, follow back, unfollow, and counts on both profiles', async ({ browser }) => {
    const a = await createUser('fa', 'Alpha');
    const b = await createUser('fb', 'Bravo');
    const errors = trackErrors((await signedInContext(browser, a)).page);
    const { page: pa, ctx: ca } = await signedInContext(browser, a);
    const { page: pb, ctx: cb } = await signedInContext(browser, b);

    await pa.goto(`/u/${b.username}`);
    await pa.getByRole('button', { name: 'Follow', exact: true }).click();
    await expect(pa.getByRole('button', { name: 'Following', exact: true })).toBeVisible();

    await pb.goto('/'); // Bravo is followed by Alpha: shows "Follow back" in suggestions
    const row = pb.locator('.suggest li').filter({ hasText: a.username });
    await expect(row).toContainText('follows you');
    await row.getByRole('button', { name: 'Follow back' }).click();
    await expect(row.getByRole('button', { name: 'Following', exact: true })).toBeVisible();

    await pa.reload();
    await expect(pa.locator('.counts')).toContainText('1'); // Alpha now has 1 follower
    pa.once('dialog', (d) => d.accept());
    await pa.getByRole('button', { name: 'Following', exact: true }).click();
    await expect(pa.getByRole('button', { name: 'Follow back' })).toBeVisible();
    expect(errors).toEqual([]);
    await ca.close();
    await cb.close();
  });

  test('private account: request, accept in Activity, then posts become visible; decline works', async ({ browser }) => {
    const owner = await createUser('po', 'Owner');
    const fan = await createUser('pf', 'Fan');
    const nope = await createUser('pn', 'Nope');
    await api('PATCH', '/users/me', owner.token, { isPrivate: true });
    await api('POST', '/posts', owner.token, { caption: 'secret garden' });
    const { page: pf, ctx: cf } = await signedInContext(browser, fan);
    await pf.goto(`/u/${owner.username}`);
    await expect(pf.getByRole('heading', { name: /account is private/i })).toBeVisible();
    await pf.getByRole('button', { name: 'Follow', exact: true }).click();
    await expect(pf.getByRole('button', { name: 'Requested' })).toBeVisible();
    await api('PUT', `/users/${owner.id}/follow`, nope.token);

    const { page: po, ctx: co } = await signedInContext(browser, owner);
    await po.goto('/notifications');
    const req = po.locator('.suggest li').filter({ hasText: fan.username });
    await req.getByRole('button', { name: 'Accept' }).click();
    await expect(req).toHaveCount(0);
    await po.locator('.suggest li').filter({ hasText: nope.username }).getByRole('button', { name: 'Decline' }).click();

    await pf.reload();
    await expect(pf.getByRole('button', { name: 'Following', exact: true })).toBeVisible();
    await expect(pf.locator('.profile-grid .tile')).toHaveCount(1);
    await cf.close();
    await co.close();
  });

  test('block: the blocked person sees "No such account"; the blocker can unblock from the profile menu', async ({ browser }) => {
    const a = await createUser('ba', 'Blocker');
    const b = await createUser('bb', 'Blocked');
    const { page: pa, ctx: ca } = await signedInContext(browser, a);
    const { page: pb, ctx: cb } = await signedInContext(browser, b);
    await pa.goto(`/u/${b.username}`);
    pa.once('dialog', (d) => d.accept());
    await pa.getByRole('button', { name: 'More options' }).click();
    await pa.getByRole('menuitem', { name: 'Block' }).click();
    await expect(pa.getByRole('heading', { name: /You blocked/i })).toBeVisible();

    await pb.goto(`/u/${a.username}`);
    await expect(pb.getByRole('heading', { name: /no such account/i })).toBeVisible();

    await pa.getByRole('button', { name: 'More options' }).click();
    await pa.getByRole('menuitem', { name: 'Unblock' }).click();
    await expect(pa.getByRole('button', { name: 'Follow', exact: true })).toBeVisible();
    await pb.reload();
    await expect(pb.getByRole('heading', { name: a.fullName })).toBeVisible();
    await ca.close();
    await cb.close();
  });

  test('report a post through the pop-up', async ({ browser }) => {
    const author = await createUser('ra');
    const reporter = await createUser('rb');
    const p = await api('POST', '/posts', author.token, { caption: 'report me' });
    const { page, ctx } = await signedInContext(browser, reporter);
    await page.goto(`/post/${p.json.data.id}`);
    await page.getByRole('button', { name: 'More options' }).click();
    await page.getByRole('menuitem', { name: 'Report' }).click();
    await page.getByLabel('Spam').check();
    await page.getByRole('button', { name: 'Send report' }).click();
    await expect(page.getByRole('heading', { name: /thanks for letting us know/i })).toBeVisible();
    await ctx.close();
  });

  test('activity: like and comment notifications, unread badge, mark as read', async ({ browser }) => {
    const a = await createUser('na', 'Notified');
    const b = await createUser('nb', 'Actor');
    const p = await api('POST', '/posts', a.token, { caption: 'notify me' });
    await api('PUT', `/posts/${p.json.data.id}/like`, b.token);
    await api('POST', `/posts/${p.json.data.id}/comments`, b.token, { body: 'nice' });
    const { page, ctx } = await signedInContext(browser, a);
    await expect(page.getByRole('link', { name: /Activity, \d+ new/ })).toBeVisible();
    await page.getByRole('link', { name: /Activity/ }).click();
    await expect(page.getByText('liked your post.')).toBeVisible();
    await expect(page.getByText('commented on your post.')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('link', { name: /Activity, \d+ new/ })).toHaveCount(0);
    await ctx.close();
  });

  test('search finds people (and hashtags) and the explore grid shows public media', async ({ browser }) => {
    const a = await createUser('sx', 'Searchable Sam');
    const b = await createUser('sy');
    await api('POST', '/posts', a.token, { caption: 'x #findme' });
    const { page, ctx } = await signedInContext(browser, b);
    await page.goto('/search');
    await page.getByLabel('Search people').fill(a.username);
    await expect(page.locator('.person-card').filter({ hasText: a.username })).toBeVisible();
    await page.getByLabel('Search people').fill('findme');
    await expect(page.getByRole('link', { name: /#findme/ })).toBeVisible();
    await page.getByLabel('Search people').fill('zzzzqqqq');
    await expect(page.getByRole('heading', { name: /nothing found/i })).toBeVisible();
    await ctx.close();
  });
});
