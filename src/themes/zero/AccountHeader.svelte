<script lang="ts">
	import { page } from '$app/stores';
	import LocaleSwitcher from '$lib/components/LocaleSwitcher.svelte';
	import { initials } from '$lib/mail/folders';
	import { setThemePreference } from '$lib/theme';
	import { t } from '$lib/i18n';
	import Logo from '$lib/components/Logo.svelte';
	import Tooltip from '$lib/components/Tooltip.svelte';
	import { ADD_ACCOUNT_HREF, switchAccount } from '$lib/account-switch';
	import type { LinkedAccount } from '$lib/types';
	import type { ThemeShellData } from '$lib/ui-theme/types';
	import Icon from './icons/Icon.svelte';

	let {
		data,
		collapsed,
		onLogout,
		onLogoutAll
	}: {
		data: ThemeShellData;
		collapsed: boolean;
		onLogout: () => Promise<void>;
		onLogoutAll?: () => Promise<void>;
	} = $props();

	let menuOpen = $state(false);
	let localeOpen = $state(false);
	let switching = $state(false);
	let switchError = $state('');
	let darkMode = $state(false);

	const otherAccounts = $derived(data.accounts.filter((account) => !account.current));

	async function switchTo(account: LinkedAccount) {
		if (switching) return;
		switching = true;
		switchError = '';
		try {
			await switchAccount(account.id);
		} catch (error) {
			switchError = error instanceof Error ? error.message : t('account.switchFailed');
			switching = false;
		}
	}

	$effect(() => {
		darkMode = document.documentElement.dataset.theme === 'dark';
	});

	const displayName = $derived(data.user.name || t('account.account'));
	const displayScope = $derived(
		data.domains.find((domain) => domain.id === data.activeDomainId)?.name ?? t('domains.all')
	);

	function closeMenus() {
		menuOpen = false;
		localeOpen = false;
	}

	function toggleMode() {
		const next = darkMode ? 'light' : 'dark';
		setThemePreference(next);
		darkMode = next === 'dark';
		closeMenus();
	}

	function onDocPointer(event: PointerEvent) {
		const target = event.target as HTMLElement | null;
		if (!target?.closest('.z-account')) closeMenus();
	}
</script>

<svelte:window onpointerdown={onDocPointer} />

<div class="z-account" class:collapsed>
	{#if collapsed}
		<Tooltip text={displayScope}>
			<button
				type="button"
				class="z-brand"
				aria-label={displayScope}
				aria-haspopup="menu"
				aria-expanded={menuOpen}
				onclick={() => {
					localeOpen = false;
					menuOpen = !menuOpen;
				}}
			>
				<Logo size={36} />
			</button>
		</Tooltip>
	{:else}
		<div class="z-account-row">
			<a href="/inbox" class="z-brand" aria-label="Fleet Mail">
				<Logo size={32} />
			</a>
			<div class="z-account-actions">
				<LocaleSwitcher
					bind:open={localeOpen}
					onOpen={() => {
						menuOpen = false;
					}}
				/>
				<Tooltip text={t('account.menu')} enabled={!menuOpen}>
					<button
						type="button"
						class="z-dots"
						aria-label={t('account.menu')}
						aria-haspopup="menu"
						aria-expanded={menuOpen}
						onclick={() => {
							localeOpen = false;
							menuOpen = !menuOpen;
						}}
					>
						<Icon name="ThreeDots" size={16} />
					</button>
				</Tooltip>
			</div>
		</div>

		<div class="z-account-meta">
			<p class="z-user-name">{displayName}</p>
			<p class="z-user-email">{displayScope}</p>
		</div>
	{/if}

	{#if menuOpen}
		<div class="z-menu z-account-menu">
			{#if collapsed}
				<LocaleSwitcher embedded />
			{/if}
			{#if otherAccounts.length > 0}
				<p class="z-menu-label">{t('account.accounts')}</p>
				{#each otherAccounts as account (account.id)}
					<button
						type="button"
						disabled={switching}
						aria-label={t('account.switchTo', { name: account.name })}
						onclick={() => switchTo(account)}
					>
						<span class="z-tile">{initials(account.name || account.email)}</span>
						<span>
							<strong>{account.name}</strong>
							<small>{account.address ?? account.email}</small>
						</span>
					</button>
				{/each}
				{#if switchError}
					<p class="z-menu-error" role="alert">{switchError}</p>
				{/if}
			{/if}
			{#if !$page.data.ownerAccess}
				<a href={ADD_ACCOUNT_HREF} onclick={closeMenus}>
				<Icon name="Plus" size={16} />
				{t('account.addAccount')}
			</a>
			{/if}
			<a href="/settings/general" onclick={closeMenus}>
				<Icon name="SettingsGear" size={16} />
				{t('nav.settings')}
			</a>
			<button type="button" onclick={toggleMode}>
				{#if darkMode}
					<Icon name="Sun" size={16} />
					{t('account.lightMode')}
				{:else}
					<Icon name="Moon" size={16} />
					{t('account.darkMode')}
				{/if}
			</button>
			<button type="button" class="logout" onclick={() => onLogout()}>
				<Icon name="ArrowLeft" size={16} />
				{t('nav.logOut')}
			</button>
			{#if otherAccounts.length > 0 && onLogoutAll}
				<button type="button" class="logout" onclick={() => onLogoutAll()}>
					<Icon name="ArrowLeft" size={16} />
					{t('account.logOutAll')}
				</button>
			{/if}
		</div>
	{/if}
</div>
