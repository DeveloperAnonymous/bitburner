import { GetAllServers, FormatMoney, FormatRam, LogMessage } from "utils.js";

let MAX_SERVERS = 25;

/*
USAGES:

buyserver (no paramters)	: Shows a price list and RAM amount, up to a power of 30 (everything past the dotted line is home upgrade sizes)
buyserver list				: Shows a list of all purchased servers
buyserver <name> <power>	: Buys a server of the specified name and size (size here is a power of 2, from 1-20), a confirmation will be shown
buyserver * <power>			: Buys servers of the specified size until we either hit the MAX_SERVERS limit, or run out of cash. NO CONFIRMATION.
buyserver loop				: Will buy servers in increasing sizes, only upgrading when said server will increase total network ram by 24% or more.
							  Once we hit the limit, it will replace smaller servers with maximum sized servers until all servers are maxed.
buyserver delete <name>		: Delete the specified server, a confirmation will be shown.
*/

/** @param {NS} ns **/
export async function main(ns) {
	ns.disableLog('ALL');

	MAX_SERVERS = ns.getPurchasedServerLimit();

	// No parameter, we list the menu
	if (ns.args[0] == null && ns.args[1] == null) {
		for (var i = 1; i <= 20; i++) {
			var ram = Math.pow(2, i);
			var cost = ns.getPurchasedServerCost(ram);
			if (cost == Infinity) continue;
			ns.tprint(i + ': ' + ns.nFormat(ram * 1000000000, '0.00b') + ' RAM ===> cost: ' + ns.nFormat(cost, "$0.0a"));
		}
		return;
	}

	if (ns.args[0] == 'upgrade') {
		const toUpgrade = GetBestUpgrade(ns);
		if (toUpgrade != undefined) {
			ns.tprint('Upgrading ' + toUpgrade.server + ' from ' + FormatRam(ns, toUpgrade.currentRam) + ' to ' + FormatRam(ns, toUpgrade.newRam) + ' would cost ' + FormatMoney(ns, toUpgrade.cost));
		}
		else {
			ns.tprint('No possible upgrades');
		}
		return;
	}

	// User wants to delete a server
	if (ns.args[0] == 'delete') {
		var resp = await ns.prompt('Confirm DELETE of server named ' + ns.args[1]);
		if (resp == false) {
			ns.tprint("Transaction aborted.");
			ns.exit();
		}

		ns.killall(ns.args[1]);
		ns.deleteServer(ns.args[1]);
		ns.tprint("Server deleted.");

		return;
	}

	// User wants the list of owned servers
	if (ns.args[0] == 'list') {
		var servers = ns.getPurchasedServers();
		for (var server of servers) {
			ns.tprint(server + ' ' + ns.nFormat(ns.getServerMaxRam(server) * 1000000000, '0.00b'));
		}
		return;
	}

	// Auto buy servers based on gain ratio
	if (ns.args[0] == 'loop') {
		const once = ns.args[1] ?? false;
		await AutoBuyPersonalServers(ns, once);
		return;
	}

	// User wants to buy a server
	var pow = ns.args[1];
	var gb = Math.pow(2, pow);

	var existing = ns.scan().filter(s => s.startsWith('crusher'));

	if (ns.args[0] == '*') {
		while (true) {
			ns.tprint('Buying multiple servers (player money= ' + ns.nFormat(ns.getPlayer().money, '0.00a') + ' server cost= ' + ns.nFormat(ns.getPurchasedServerCost(gb), '0.00a') + ')');
			var nbServers = existing.length;
			while (ns.getPurchasedServerCost(gb) < ns.getPlayer().money && nbServers < 25) {
				var found = false;
				var serverName = undefined;
				for (var i = 1; i <= 25; i++) {
					if (!existing.find(p => p == 'crusher-' + i)) {
						serverName = 'crusher-' + i;
						found = true;
						break;
					}
				}

				if (!found) {
					ns.tprint('Could not find suitable name, aborting.');
					ns.exit();
				}

				ns.tprint('Buying server ' + serverName);
				ns.purchaseServer(serverName, gb);
				nbServers++;
				existing.push(serverName);
			}

			if (ns.args[2] != 'loop') break;
			await ns.sleep(1000);
		}
	}
	else {
		var resp = await ns.prompt('Confirm purchase of server named ' + ns.args[0] + ' with ' + ns.nFormat(gb * 1000000000, '0.00b') + ' RAM for ' + ns.nFormat(ns.getPurchasedServerCost(2 ** pow), '0.00a'));
		if (resp == false) {
			ns.tprint("Transaction aborted.");
			return;
		}

		ns.tprint('Confirming transaction');
		ns.purchaseServer(ns.args[0], gb);
	}
}

function GetBestUpgrade(ns) {
	//const networkRam = GetAllServers(ns).filter(s => ns.hasRootAccess(s) && ns.getServerMaxRam(s) > 0).reduce((sum, s) => sum + ns.getServerMaxRam(s), 0);
	const budget = ns.getServerMoneyAvailable('home');
	const existingServers = ns.getPurchasedServers();
	const MAX_POW = Math.log(ns.getPurchasedServerMaxRam()) / Math.log(2);

	let best = undefined;

	for (const server of existingServers) {
		const currentRam = ns.getServerMaxRam(server);
		const currentPow = Math.log(currentRam) / Math.log(2);

		for (let i = MAX_POW; i > currentPow; i--) {
			const newRam = Math.pow(2, i);
			const upgradeCost = ns.getPurchasedServerUpgradeCost(server, newRam);
			if (upgradeCost > budget) continue;
			const amount = newRam - currentRam;

			if (best == null || amount > best.amount) {
				best = { server: server, amount: amount, currentRam: currentRam, newRam: newRam, cost: upgradeCost };
			}
		}
	}

	return best;
}

export async function AutoBuyPersonalServers(ns, once) {
	let MAX_SERVER_POW = 20;
	const MIN_GAIN_PCT = 0.24;

	while (true) {
		let networkRam = GetAllServers(ns).filter(s => ns.hasRootAccess(s) && ns.getServerMaxRam(s) > 0).reduce((sum, s) => sum + ns.getServerMaxRam(s), 0);
		let money = ns.getServerMoneyAvailable('home');

		let existingServers = ns.getPurchasedServers();

		let boughtAnything = false;

		for (let pow = MAX_SERVER_POW; pow > 2; pow--) {
			const serverRam = Math.pow(2, pow);
			const serverCost = ns.getPurchasedServerCost(serverRam);
			if (serverCost == Infinity) continue;
			if (serverCost > money) {
				continue;
			}
			const gainRatio = serverRam / networkRam;
			ns.print('INFO: Best personal server we can buy with our money right now is ' +
				ns.nFormat(serverRam * 1000000000, '0.00b') + ' for ' + ns.nFormat(serverCost, '0.00a') + ' at a gain ratio of ' + Math.round(gainRatio * 100) + '%');

			if (gainRatio >= MIN_GAIN_PCT || pow == MAX_SERVER_POW) {
				// ns.tprint('Buying a new personal server...');
				// ns.print('Buying a new personal server...');

				// Upgrade smallest server if we have cash for a bigger one
				if (existingServers.length >= MAX_SERVERS) {
					const toUpgrade = GetBestUpgrade(ns);
					if (toUpgrade != undefined) {
						ns.tprint('Upgrading ' + toUpgrade.server + ' from ' + FormatRam(ns, toUpgrade.currentRam) + ' to ' + FormatRam(ns, toUpgrade.newRam) + ' for ' + FormatMoney(ns, toUpgrade.cost));
						ns.upgradePurchasedServer(toUpgrade.server, toUpgrade.newRam);
						LogMessage(ns, 'Upgrading ' + toUpgrade.server + ' from ' + FormatRam(ns, toUpgrade.currentRam) + ' to ' + FormatRam(ns, toUpgrade.newRam) + ' for ' + FormatMoney(ns, toUpgrade.cost));
					}
					else {
						if (!once)
							ns.tprint('INFO: Server limit of ' + MAX_SERVERS + ' has been reached and all servers are maxed out! Job\'s done!');
						ns.print('INFO: Server limit of ' + MAX_SERVERS + ' has been reached and all servers are maxed out! Job\'s done!');
						return;
					}
					continue;
					// existingServers = existingServers.sort((a, b) => ns.getServerMaxRam(b) - ns.getServerMaxRam(a));
					// let toDelete = existingServers.pop();
					// let smallestSize = ns.getServerMaxRam(toDelete);

					// if (smallestSize < serverRam) {
					// 	if (!once)
					// 		ns.tprint('WARN: Server limit of ' + MAX_SERVERS + ' has been reached, deleting ' + toDelete + ' (smallest server with ' + ns.nFormat(smallestSize * 1000000000, '0.00b') + ')');
					// 	ns.print('WARN: Server limit of ' + MAX_SERVERS + ' has been reached, deleting ' + toDelete + ' (smallest server with ' + ns.nFormat(smallestSize * 1000000000, '0.00b') + ')');

					// 	ns.killall(toDelete);
					// 	await ns.sleep(10);
					// 	ns.deleteServer(toDelete);
					// 	await ns.sleep(10);
					// 	existingServers = ns.getPurchasedServers();
					// 	await ns.sleep(10);
					// }
					// else {
					// 	if (!once)
					// 		ns.tprint('INFO: Server limit of ' + MAX_SERVERS + ' has been reached and all servers are maxed out! Job\'s done!');
					// 	ns.print('INFO: Server limit of ' + MAX_SERVERS + ' has been reached and all servers are maxed out! Job\'s done!');
					// 	return;
					// }
				}

				// Find a name				
				var found = false;
				var serverName = undefined;
				for (var i = 1; i <= MAX_SERVERS; i++) {
					if (!existingServers.find(p => p == 'crusher-' + i)) {
						serverName = 'crusher-' + i;
						found = true;
						break;
					}
				}

				if (!found) {
					ns.tprint('Could not find suitable name, aborting.');
					ns.print('Could not find suitable name, aborting.');
					break;
				}

				ns.tprint('Buying server ' + serverName + ' (' + ns.nFormat(serverRam * 1000000000, '0.00b') + ' for ' + ns.nFormat(serverCost, '0.00a') + ')');
				ns.print('Buying server ' + serverName + ' (' + ns.nFormat(serverRam * 1000000000, '0.00b') + ' for ' + ns.nFormat(serverCost, '0.00a') + ')');
				LogMessage(ns, 'Buying server ' + serverName + ' (' + ns.nFormat(serverRam * 1000000000, '0.00b') + ' for ' + ns.nFormat(serverCost, '0.00a') + ')');
				ns.purchaseServer(serverName, serverRam);

				boughtAnything = true;
				break;
			}

			break;
		}

		if (!boughtAnything && once)
			return;

		await ns.sleep(50);
	}
}