import type { TeamId } from "./teams";

export type Pos = "GK" | "DEF" | "MID" | "FWD";

export type Player = {
  id: string;
  name: string;
  team: TeamId;
  pos: Pos;
  adp: number;
  /** Percentiles 0-100 across G, A, xG, Min, CS/saves, bonus */
  heat: [number, number, number, number, number, number];
  form: number;
};

export const HEAT_LABELS = ["G", "A", "xG", "Min", "CS", "Bon"] as const;

// Draft board only. Match intel reads ESPN scorers from `/api/matches/recent`.
export const PLAYERS: Player[] = [
  { id: "haaland", name: "Haaland", team: "MCI", pos: "FWD", adp: 1.2, heat: [99, 42, 98, 88, 12, 94], form: 8.4 },
  { id: "isak", name: "Isak", team: "LIV", pos: "FWD", adp: 2.1, heat: [96, 55, 94, 86, 18, 91], form: 9.1 },
  { id: "salah", name: "Salah", team: "LIV", pos: "MID", adp: 3.4, heat: [92, 78, 90, 91, 22, 88], form: 7.8 },
  { id: "saka", name: "Saka", team: "ARS", pos: "MID", adp: 4.0, heat: [84, 86, 82, 90, 28, 85], form: 7.6 },
  { id: "palmer", name: "Palmer", team: "CHE", pos: "MID", adp: 5.2, heat: [80, 81, 79, 87, 16, 82], form: 6.9 },
  { id: "mbeumo", name: "Mbeumo", team: "MUN", pos: "MID", adp: 7.8, heat: [74, 72, 71, 85, 14, 76], form: 7.4 },
  { id: "sesko", name: "Sesko", team: "MUN", pos: "FWD", adp: 8.4, heat: [78, 38, 80, 74, 10, 77], form: 7.2 },
  { id: "odegaard", name: "Ødegaard", team: "ARS", pos: "MID", adp: 9.1, heat: [62, 88, 64, 86, 26, 74], form: 7.5 },
  { id: "havertz", name: "Havertz", team: "ARS", pos: "FWD", adp: 10.6, heat: [76, 48, 74, 82, 24, 73], form: 7.1 },
  { id: "foden", name: "Foden", team: "MCI", pos: "MID", adp: 11.2, heat: [70, 74, 69, 78, 18, 72], form: 6.4 },
  { id: "gakpo", name: "Gakpo", team: "LIV", pos: "MID", adp: 12.4, heat: [68, 70, 67, 76, 20, 70], form: 7.9 },
  { id: "rogers", name: "Rogers", team: "CHE", pos: "MID", adp: 13.8, heat: [66, 64, 65, 80, 12, 68], form: 6.8 },
  { id: "watkins", name: "Watkins", team: "AVL", pos: "FWD", adp: 14.5, heat: [72, 44, 73, 84, 14, 69], form: 5.8 },
  { id: "mateta", name: "Mateta", team: "CRY", pos: "FWD", adp: 16.2, heat: [71, 36, 70, 81, 16, 67], form: 7.3 },
  { id: "solanke", name: "Solanke", team: "TOT", pos: "FWD", adp: 17.4, heat: [69, 40, 68, 79, 12, 64], form: 5.4 },
  { id: "gordon", name: "Gordon", team: "NEW", pos: "MID", adp: 18.1, heat: [64, 66, 63, 77, 18, 63], form: 6.2 },
  { id: "semenyo", name: "Semenyo", team: "BOU", pos: "MID", adp: 19.6, heat: [63, 58, 62, 83, 10, 61], form: 7.0 },
  { id: "johnson", name: "Johnson", team: "TOT", pos: "MID", adp: 21.0, heat: [61, 55, 60, 75, 14, 58], form: 5.1 },
  { id: "bruno", name: "B. Fernandes", team: "MUN", pos: "MID", adp: 22.3, heat: [58, 84, 61, 88, 16, 71], form: 6.6 },
  { id: "rice", name: "Rice", team: "ARS", pos: "MID", adp: 23.5, heat: [42, 62, 40, 94, 48, 60], form: 6.8 },
  { id: "macallister", name: "Mac Allister", team: "LIV", pos: "MID", adp: 24.8, heat: [44, 70, 46, 86, 36, 59], form: 6.5 },
  { id: "rodri", name: "Rodri", team: "MCI", pos: "MID", adp: 26.1, heat: [38, 60, 36, 82, 44, 55], form: 6.1 },
  { id: "saliba", name: "Saliba", team: "ARS", pos: "DEF", adp: 27.4, heat: [22, 18, 16, 96, 82, 64], form: 7.0 },
  { id: "vvd", name: "van Dijk", team: "LIV", pos: "DEF", adp: 28.2, heat: [28, 16, 22, 95, 78, 66], form: 7.2 },
  { id: "gabriel", name: "Gabriel", team: "ARS", pos: "DEF", adp: 29.6, heat: [34, 12, 28, 93, 80, 62], form: 6.9 },
  { id: "gvardiol", name: "Gvardiol", team: "MCI", pos: "DEF", adp: 31.0, heat: [30, 28, 26, 88, 70, 58], form: 6.3 },
  { id: "trippier", name: "Trippier", team: "NEW", pos: "DEF", adp: 32.4, heat: [8, 74, 10, 84, 54, 57], form: 5.8 },
  { id: "alexander-arnold", name: "Alexander-Arnold", team: "LIV", pos: "DEF", adp: 33.1, heat: [14, 80, 18, 80, 58, 61], form: 6.4 },
  { id: "calafiori", name: "Calafiori", team: "ARS", pos: "DEF", adp: 34.8, heat: [26, 32, 24, 78, 68, 56], form: 7.4 },
  { id: "colwill", name: "Colwill", team: "CHE", pos: "DEF", adp: 36.2, heat: [16, 22, 14, 86, 62, 50], form: 5.9 },
  { id: "raya", name: "Raya", team: "ARS", pos: "GK", adp: 37.5, heat: [0, 4, 0, 98, 84, 72], form: 6.7 },
  { id: "alisson", name: "Alisson", team: "LIV", pos: "GK", adp: 38.8, heat: [0, 6, 0, 92, 76, 68], form: 7.1 },
  { id: "donnarumma", name: "Donnarumma", team: "MCI", pos: "GK", adp: 40.2, heat: [0, 2, 0, 90, 72, 64], form: 6.5 },
  { id: "pickford", name: "Pickford", team: "EVE", pos: "GK", adp: 42.6, heat: [0, 8, 0, 97, 48, 70], form: 6.8 },
  { id: "munoz", name: "Muñoz", team: "CRY", pos: "DEF", adp: 43.9, heat: [24, 58, 22, 89, 52, 54], form: 7.2 },
  { id: "kerkez", name: "Kerkez", team: "LIV", pos: "DEF", adp: 45.1, heat: [12, 52, 14, 82, 56, 49], form: 6.6 },
  { id: "lewis-skelly", name: "Lewis-Skelly", team: "ARS", pos: "DEF", adp: 46.4, heat: [10, 44, 12, 74, 64, 48], form: 6.4 },
  { id: "pedro", name: "J. Pedro", team: "CHE", pos: "FWD", adp: 47.8, heat: [60, 46, 62, 70, 8, 55], form: 5.7 },
  { id: "jackson", name: "Jackson", team: "CHE", pos: "FWD", adp: 49.2, heat: [58, 40, 64, 68, 8, 52], form: 5.2 },
  { id: "wood", name: "Wood", team: "NFO", pos: "FWD", adp: 50.6, heat: [65, 22, 60, 80, 14, 53], form: 5.0 },
  { id: "welbeck", name: "Welbeck", team: "BHA", pos: "FWD", adp: 52.0, heat: [56, 34, 55, 72, 12, 50], form: 5.6 },
  { id: "cunha", name: "Cunha", team: "MUN", pos: "FWD", adp: 53.3, heat: [54, 50, 56, 66, 8, 51], form: 5.9 },
  { id: "barnes", name: "Barnes", team: "NEW", pos: "MID", adp: 54.7, heat: [52, 48, 50, 70, 16, 49], form: 6.3 },
  { id: "ramsey", name: "J. Ramsey", team: "NEW", pos: "MID", adp: 56.1, heat: [46, 54, 44, 68, 18, 47], form: 6.5 },
  { id: "elanga", name: "Elanga", team: "NEW", pos: "MID", adp: 57.5, heat: [48, 52, 46, 71, 14, 46], form: 5.8 },
  { id: "mitoma", name: "Mitoma", team: "BHA", pos: "MID", adp: 58.8, heat: [50, 56, 48, 69, 12, 48], form: 5.5 },
  { id: "minteh", name: "Minteh", team: "BHA", pos: "MID", adp: 60.2, heat: [44, 50, 45, 64, 10, 44], form: 5.7 },
  { id: "kudus", name: "Kudus", team: "TOT", pos: "MID", adp: 61.5, heat: [47, 49, 48, 67, 12, 45], form: 5.3 },
  { id: "maddison", name: "Maddison", team: "TOT", pos: "MID", adp: 62.9, heat: [40, 68, 42, 62, 12, 47], form: 4.9 },
  { id: "eze", name: "Eze", team: "ARS", pos: "MID", adp: 64.1, heat: [49, 60, 50, 60, 18, 48], form: 5.4 },
  { id: "saka-backup", name: "Martinelli", team: "ARS", pos: "MID", adp: 65.4, heat: [45, 46, 47, 58, 16, 42], form: 4.8 },
  { id: "neto", name: "Neto", team: "CHE", pos: "MID", adp: 66.8, heat: [43, 51, 44, 63, 10, 43], form: 5.1 },
  { id: "caicedo", name: "Caicedo", team: "CHE", pos: "MID", adp: 68.0, heat: [18, 36, 16, 90, 38, 40], form: 5.8 },
  { id: "gravenberch", name: "Gravenberch", team: "LIV", pos: "MID", adp: 69.3, heat: [22, 40, 20, 84, 34, 41], form: 6.2 },
  { id: "szoboszlai", name: "Szoboszlai", team: "LIV", pos: "MID", adp: 70.6, heat: [36, 58, 38, 76, 24, 44], form: 6.0 },
  { id: "grealish", name: "Grealish", team: "EVE", pos: "MID", adp: 72.0, heat: [32, 62, 34, 70, 14, 43], form: 6.1 },
  { id: "ndiaye", name: "Ndiaye", team: "EVE", pos: "MID", adp: 73.4, heat: [41, 44, 40, 72, 12, 42], form: 6.4 },
  { id: "george", name: "T. George", team: "EVE", pos: "FWD", adp: 74.8, heat: [38, 28, 36, 54, 8, 40], form: 6.6 },
  { id: "mbeumo-def", name: "Guehi", team: "CRY", pos: "DEF", adp: 76.1, heat: [20, 14, 14, 92, 58, 46], form: 6.7 },
  { id: "lacroix", name: "Lacroix", team: "CRY", pos: "DEF", adp: 77.4, heat: [18, 10, 12, 88, 56, 44], form: 6.5 },
  { id: "schar", name: "Schär", team: "NEW", pos: "DEF", adp: 78.8, heat: [32, 16, 26, 80, 50, 45], form: 5.6 },
  { id: "burn", name: "Burn", team: "NEW", pos: "DEF", adp: 80.1, heat: [16, 12, 12, 86, 52, 40], form: 5.7 },
  { id: "livramento", name: "Livramento", team: "NEW", pos: "DEF", adp: 81.4, heat: [8, 40, 10, 74, 46, 38], form: 5.5 },
  { id: "konsa", name: "Konsa", team: "AVL", pos: "DEF", adp: 82.7, heat: [14, 18, 12, 85, 48, 39], form: 5.4 },
  { id: "digne", name: "Digne", team: "AVL", pos: "DEF", adp: 84.0, heat: [6, 56, 8, 78, 42, 41], form: 5.3 },
  { id: "pau", name: "Pau Torres", team: "AVL", pos: "DEF", adp: 85.3, heat: [12, 14, 10, 76, 44, 36], form: 5.2 },
  { id: "cash", name: "Cash", team: "AVL", pos: "DEF", adp: 86.6, heat: [18, 36, 16, 72, 40, 37], form: 5.1 },
  { id: "robinson", name: "Robinson", team: "FUL", pos: "DEF", adp: 87.9, heat: [8, 48, 10, 88, 36, 38], form: 5.8 },
  { id: "tete", name: "Tete", team: "FUL", pos: "DEF", adp: 89.2, heat: [10, 34, 12, 70, 32, 34], form: 5.0 },
  { id: "andersen", name: "Andersen", team: "FUL", pos: "DEF", adp: 90.5, heat: [14, 12, 12, 82, 34, 35], form: 4.9 },
  { id: "iwobi", name: "Iwobi", team: "FUL", pos: "MID", adp: 91.8, heat: [34, 46, 32, 74, 12, 39], form: 5.4 },
  { id: "smithrowe", name: "Smith Rowe", team: "FUL", pos: "MID", adp: 93.1, heat: [36, 42, 34, 58, 10, 37], form: 4.8 },
  { id: "jimenez", name: "Jiménez", team: "FUL", pos: "FWD", adp: 94.4, heat: [42, 24, 44, 62, 8, 36], form: 5.2 },
  { id: "wissa", name: "Wissa", team: "BRE", pos: "FWD", adp: 95.6, heat: [55, 26, 52, 76, 10, 44], form: 5.6 },
  { id: "mbeumo-gone", name: "Schade", team: "BRE", pos: "MID", adp: 96.8, heat: [40, 38, 42, 68, 10, 36], form: 5.3 },
  { id: "damsgaard", name: "Damsgaard", team: "BRE", pos: "MID", adp: 98.0, heat: [28, 52, 30, 70, 12, 38], form: 5.5 },
  { id: "vanzeer", name: "van de Ven", team: "TOT", pos: "DEF", adp: 99.3, heat: [16, 10, 14, 64, 50, 36], form: 4.7 },
  { id: "udogie", name: "Udogie", team: "TOT", pos: "DEF", adp: 100.6, heat: [10, 38, 12, 66, 46, 35], form: 4.8 },
  { id: "romero", name: "Romero", team: "TOT", pos: "DEF", adp: 101.9, heat: [22, 8, 18, 72, 48, 37], form: 4.6 },
  { id: "porro", name: "Porro", team: "TOT", pos: "DEF", adp: 103.2, heat: [12, 60, 16, 80, 44, 42], form: 5.0 },
  { id: "vicario", name: "Vicario", team: "TOT", pos: "GK", adp: 104.5, heat: [0, 4, 0, 86, 46, 52], form: 5.2 },
  { id: "sanchez", name: "Sánchez", team: "CHE", pos: "GK", adp: 105.8, heat: [0, 2, 0, 84, 50, 48], form: 5.0 },
  { id: "pope", name: "Pope", team: "NEW", pos: "GK", adp: 107.1, heat: [0, 2, 0, 88, 52, 50], form: 5.4 },
  { id: "leno", name: "Leno", team: "FUL", pos: "GK", adp: 108.4, heat: [0, 6, 0, 94, 34, 54], form: 5.6 },
  { id: "verbruggen", name: "Verbruggen", team: "BHA", pos: "GK", adp: 109.7, heat: [0, 4, 0, 90, 40, 46], form: 5.1 },
  { id: "sels", name: "Sels", team: "NFO", pos: "GK", adp: 111.0, heat: [0, 2, 0, 92, 42, 48], form: 5.3 },
  { id: "roefs", name: "Roefs", team: "SUN", pos: "GK", adp: 112.4, heat: [0, 8, 0, 88, 38, 44], form: 5.7 },
  { id: "kelleher", name: "Kelleher", team: "BRE", pos: "GK", adp: 113.8, heat: [0, 2, 0, 80, 36, 40], form: 4.9 },
  { id: "muric", name: "Muric", team: "IPS", pos: "GK", adp: 115.2, heat: [0, 4, 0, 86, 22, 42], form: 4.4 },
  { id: "meslier", name: "Meslier", team: "LEE", pos: "GK", adp: 116.6, heat: [0, 6, 0, 90, 28, 46], form: 4.8 },
  { id: "darlow", name: "Darlow", team: "HUL", pos: "GK", adp: 118.0, heat: [0, 2, 0, 84, 30, 38], form: 4.6 },
  { id: "wilson", name: "Wilson", team: "COV", pos: "GK", adp: 119.4, heat: [0, 2, 0, 82, 24, 36], form: 4.2 },
  { id: "brobbey", name: "Brobbey", team: "SUN", pos: "FWD", adp: 120.8, heat: [48, 22, 50, 64, 8, 40], form: 5.8 },
  { id: "lefee", name: "Le Fée", team: "SUN", pos: "MID", adp: 122.2, heat: [24, 48, 26, 72, 16, 38], form: 5.5 },
  { id: "xhaka", name: "Xhaka", team: "SUN", pos: "MID", adp: 123.6, heat: [20, 44, 18, 86, 22, 40], form: 5.9 },
  { id: "pinnock", name: "Pinnock", team: "BRE", pos: "DEF", adp: 125.0, heat: [18, 8, 14, 84, 36, 32], form: 5.0 },
  { id: "vanhecke", name: "van Hecke", team: "BHA", pos: "DEF", adp: 126.4, heat: [12, 10, 10, 86, 40, 33], form: 5.1 },
  { id: "dunk", name: "Dunk", team: "BHA", pos: "DEF", adp: 127.8, heat: [20, 6, 16, 80, 38, 34], form: 4.8 },
  { id: "estupinan", name: "Estupiñán", team: "BHA", pos: "DEF", adp: 129.2, heat: [6, 50, 8, 62, 34, 32], form: 4.9 },
  { id: "rodon", name: "Rodon", team: "LEE", pos: "DEF", adp: 130.6, heat: [10, 8, 8, 88, 32, 30], form: 5.2 },
  { id: "strujik", name: "Struijk", team: "LEE", pos: "DEF", adp: 132.0, heat: [14, 12, 12, 82, 30, 31], form: 5.0 },
  { id: "aaronson", name: "Aaronson", team: "LEE", pos: "MID", adp: 133.4, heat: [26, 36, 28, 70, 10, 32], form: 5.3 },
  { id: "james", name: "D. James", team: "LEE", pos: "MID", adp: 134.8, heat: [30, 32, 30, 66, 8, 31], form: 5.1 },
  { id: "delap", name: "Delap", team: "IPS", pos: "FWD", adp: 136.2, heat: [44, 18, 48, 72, 6, 34], form: 4.6 },
  { id: "hutchinson", name: "Hutchinson", team: "IPS", pos: "MID", adp: 137.6, heat: [28, 34, 30, 68, 8, 30], form: 4.5 },
  { id: "wohler", name: "Greaves", team: "IPS", pos: "DEF", adp: 139.0, heat: [8, 10, 8, 84, 22, 26], form: 4.3 },
  { id: "cissoko", name: "Cissoko", team: "HUL", pos: "FWD", adp: 140.4, heat: [36, 20, 38, 60, 8, 28], form: 4.7 },
  { id: "slater", name: "Slater", team: "HUL", pos: "MID", adp: 141.8, heat: [16, 30, 18, 74, 14, 26], form: 4.8 },
  { id: "greaves-hul", name: "Jones", team: "HUL", pos: "DEF", adp: 143.2, heat: [6, 8, 6, 80, 28, 24], form: 4.5 },
  { id: "simms", name: "Simms", team: "COV", pos: "FWD", adp: 144.6, heat: [34, 16, 36, 58, 6, 26], form: 4.2 },
  { id: "eccles", name: "Eccles", team: "COV", pos: "MID", adp: 146.0, heat: [14, 28, 16, 70, 12, 24], form: 4.1 },
  { id: "kitching", name: "Kitching", team: "COV", pos: "DEF", adp: 147.4, heat: [8, 6, 6, 76, 20, 22], form: 4.0 },
  { id: "milenkovic", name: "Milenković", team: "NFO", pos: "DEF", adp: 148.8, heat: [16, 8, 12, 86, 40, 32], form: 5.1 },
  { id: "aina", name: "Aina", team: "NFO", pos: "DEF", adp: 150.2, heat: [6, 32, 8, 78, 36, 30], form: 5.0 },
  { id: "gibbswhite", name: "Gibbs-White", team: "NFO", pos: "MID", adp: 151.6, heat: [32, 54, 34, 76, 14, 38], form: 5.2 },
  { id: "eltaib", name: "Elanga", team: "NFO", pos: "MID", adp: 153.0, heat: [30, 40, 32, 64, 10, 33], form: 4.7 },
  { id: "tavernier", name: "Tavernier", team: "BOU", pos: "MID", adp: 154.4, heat: [28, 46, 30, 80, 12, 36], form: 6.4 },
  { id: "kluivert", name: "Kluivert", team: "BOU", pos: "MID", adp: 155.8, heat: [38, 40, 40, 62, 8, 34], form: 5.6 },
  { id: "kerkez-old", name: "Senesi", team: "BOU", pos: "DEF", adp: 157.2, heat: [10, 16, 10, 82, 34, 28], form: 5.4 },
  { id: "kerkez2", name: "Smith", team: "BOU", pos: "DEF", adp: 158.6, heat: [4, 22, 6, 74, 30, 26], form: 5.2 },
  { id: "evanilson", name: "Evanilson", team: "BOU", pos: "FWD", adp: 160.0, heat: [46, 24, 48, 66, 8, 35], form: 5.7 },
];

export const PLAYERS_BY_ADP = [...PLAYERS].sort((a, b) => a.adp - b.adp);

export function getPlayer(id: string) {
  return PLAYERS.find((p) => p.id === id);
}

export function playersForTeam(team: TeamId, n = 3) {
  const rank = (p: Player) =>
    (p.pos === "FWD" ? 220 : p.pos === "MID" ? 110 : 0) + p.heat[0] * 1.2 + p.form * 8;
  return PLAYERS.filter((p) => p.team === team)
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, n);
}

export function findPlayersInText(text: string) {
  const q = text.toLowerCase();
  const hits: Player[] = [];
  for (const p of PLAYERS) {
    const name = p.name.toLowerCase();
    const last = name.split(" ").pop() ?? name;
    const needle = last.length >= 4 ? last : name;
    if (needle.length < 4) continue;
    if (q.includes(needle) && !hits.some((h) => h.id === p.id)) hits.push(p);
    if (hits.length >= 8) break;
  }
  return hits;
}
