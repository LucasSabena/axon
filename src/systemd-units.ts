// Units whose stop/restart/disable can take down the host, every container
// (Axon included) or the only remote-access path. Shared by every systemctl
// mutation endpoint so the protection can't drift per-route.
const CRITICAL_BASES = new Set([
  // container/VM runtimes and orchestrators — Axon itself runs in Docker
  'docker', 'dockerd', 'containerd', 'crio', 'cri-o', 'cri-docker', 'cri-dockerd',
  'podman', 'kubelet', 'k3s', 'k0s', 'lxd', 'lxcfs', 'incus', 'libvirtd',
  // network + the tunnels that are likely the only way back in
  'ssh', 'sshd', 'networking', 'dhcpcd', 'dhclient', 'connman', 'ifup',
  'netplan-wpa', 'wpa_supplicant', 'wpa_supplicant-nl80211', 'wpa_supplicant-wired',
  'iwd', 'cloudflared', 'tailscaled', 'zerotier-one', 'wg-quick', 'openvpn',
  'openvpn-client', 'openvpn-server',
  // message bus, init and console access
  'dbus', 'dbus-broker', 'dbus-daemon', 'fail2ban', 'init', 'getty',
  'serial-getty', 'user', 'user-runtime-dir',
  // runlevel units — restarting them drops the host into rescue/emergency
  'rescue', 'emergency',
  // display managers — stopping kills the graphical session (Axon has a
  // desktop feature and the panel itself may be operated from it)
  'gdm', 'gdm3', 'lightdm', 'sddm', 'xdm', 'lxdm', 'greetd',
  'display-manager', 'plymouth-quit',
  // packet filters — stopping one can cut the only way back in
  'ufw', 'firewalld', 'nftables', 'netfilter-persistent', 'shorewall',
  'shorewall6', 'iptables', 'ip6tables', 'ebtables',
  // auth/policy and audit plumbing — disabling them breaks system auth
  'polkit', 'polkitd', 'auditd', 'apparmor', 'selinux-autorelabel',
  'ModemManager', 'rsyslog', 'syslog', 'syslog-ng',
  // lower-case sysv alias of NetworkManager on Debian — same remote-access loss
  'network-manager',
  // overlay/virtual switching — stopping tears down every guest/container net
  'openvswitch-switch', 'openvswitch-ipsec', 'ovs-vswitchd', 'ovsdb-server',
  // remote-access daemons — same class as sshd/tailscaled: the only way back in
  'xrdp', 'xrdp-sesman', 'vncserver', 'tigervncserver', 'nxserver',
  'teamviewerd', 'rustdesk', 'chrome-remote-desktop', 'cockpit', 'anydesk',
  // self-hosted tunnels not covered above
  'frpc', 'frps', 'ngrok', 'ngrokd', 'pagekite', 'inlets', 'localtunnel',
  // domain/auth/home plumbing — stopping locks out every login
  'sssd', 'winbind', 'nslcd', 'nscd', 'autofs', 'oddjobd', 'ypbind', 'nis',
  'slapd', 'dirsrv', 'libvirt-guests',
  // storage fabric — stopping loses the disks under live mounts
  'iscsid', 'iscsiuio', 'open-iscsi', 'multipathd', 'lvm2-monitor',
  'mdmonitor', 'mdadm', 'udisks2', 'tgt', 'scst',
  // device manager + clock — breaking either cascades everywhere
  'udev', 'chronyd', 'ntpd', 'ntpsec', 'openntpd', 'ntp',
  // more display managers / seat daemons
  'ly', 'slim', 'nodm', 'wdm', 'seatd', 'console-getty', 'container-getty',
  'getty-static',
]);
// Prefixes cover template/hyphenated families: systemd-* (networkd, resolved,
// logind, user-sessions, …), NetworkManager(-dispatcher|-wait-online), every
// dbus-org.freedesktop.* bus alias (they're all privileged infra), login
// sessions, container cgroup scopes and Axon's own units.
// NOTE: checked AFTER stripping suffix and @instance — match bare stems only.
const CRITICAL_PREFIX = /^(systemd-|NetworkManager|networkd-|dbus-org\.freedesktop\.|session-|run-user-|axon|docker-|libpod-|cri-|kubepods-|machine-)/;

export function isCriticalUnit(unit: string): boolean {
  // Strip the .suffix first, then the @instance — truncating at the first dot
  // would turn `dbus-org.freedesktop.network1` into just `dbus-org` and the
  // prefix check would never see the alias.
  const name = unit.replace(/\.(service|socket|timer|scope|mount|target|slice|path|automount|swap|device)$/, '').split('@')[0];
  return CRITICAL_BASES.has(name) || CRITICAL_PREFIX.test(name);
}
