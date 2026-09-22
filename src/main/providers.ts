export interface DnsProvider {
  id: string;
  name: string;
  description: string;
  primary: string;
  secondary: string;
  /** brand color for avatar fallback */
  color: string;
  /** bundled logo file in assets/providers/ */
  icon: string;
  /** doh hostname for display */
  doh?: string;
}

export const DNS_PROVIDERS: DnsProvider[] = [
  {
    id: "cloudflare",
    name: "Cloudflare",
    description: "Fast, private. 1.1.1.1",
    primary: "1.1.1.1",
    secondary: "1.0.0.1",
    color: "#F6821F",
    icon: "cloudflare.png",
    doh: "cloudflare-dns.com",
  },
  {
    id: "google",
    name: "Google",
    description: "Reliable, widely cached",
    primary: "8.8.8.8",
    secondary: "8.8.4.4",
    color: "#4285F4",
    icon: "google.png",
    doh: "dns.google",
  },
  {
    id: "quad9",
    name: "Quad9",
    description: "Security + malware blocking",
    primary: "9.9.9.9",
    secondary: "149.112.112.112",
    color: "#7B1FA2",
    icon: "quad9.png",
    doh: "dns.quad9.net",
  },
  {
    id: "opendns",
    name: "OpenDNS",
    description: "Cisco Umbrella, filtering",
    primary: "208.67.222.222",
    secondary: "208.67.220.220",
    color: "#FF4013",
    icon: "opendns.png",
    doh: "doh.opendns.com",
  },
  {
    id: "adguard",
    name: "AdGuard",
    description: "Blocks ads & trackers",
    primary: "94.140.14.14",
    secondary: "94.140.15.15",
    color: "#67B279",
    icon: "adguard.png",
    doh: "dns.adguard-dns.com",
  },
  {
    id: "adguard-family",
    name: "AdGuard Family",
    description: "Ads + adult content block",
    primary: "94.140.14.15",
    secondary: "94.140.15.16",
    color: "#2E7D32",
    icon: "adguard-family.png",
    doh: "dns-family.adguard-dns.com",
  },
  {
    id: "cleanbrowsing-sec",
    name: "CleanBrowsing",
    description: "Security filter",
    primary: "185.228.168.9",
    secondary: "185.228.169.9",
    color: "#0097A7",
    icon: "cleanbrowsing.png",
    doh: "doh.cleanbrowsing.org",
  },
  {
    id: "comodo",
    name: "Comodo Secure",
    description: "Security-focused",
    primary: "8.26.56.26",
    secondary: "8.20.247.20",
    color: "#C62828",
    icon: "comodo.png",
  },
  {
    id: "level3",
    name: "Lumen (Level 3)",
    description: "Tier-1 backbone",
    primary: "4.2.2.1",
    secondary: "4.2.2.2",
    color: "#37474F",
    icon: "level3.png",
  },
  {
    id: "verisign",
    name: "Verisign",
    description: "Stable, no filtering",
    primary: "64.6.64.6",
    secondary: "64.6.65.6",
    color: "#1565C0",
    icon: "verisign.png",
  },
  {
    id: "controld",
    name: "Control D",
    description: "Customizable filtering",
    primary: "76.76.2.0",
    secondary: "76.76.10.0",
    color: "#6A1B9A",
    icon: "controld.png",
    doh: "freedns.controld.com",
  },
  {
    id: "nextdns",
    name: "NextDNS",
    description: "Privacy w/ analytics",
    primary: "45.90.28.0",
    secondary: "45.90.30.0",
    color: "#0277BD",
    icon: "nextdns.png",
    doh: "dns.nextdns.io",
  },
];

export function getProvider(id: string): DnsProvider | undefined {
  return DNS_PROVIDERS.find((p) => p.id === id);
}
