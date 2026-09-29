export type Product = {
  id: string;
  name: string;
  latin: string;
  group: "Meyve" | "İbreli" | "Çit" | "Yaprak döken";
  price: number;
  size: string;
  image: string;
  note: string;
  light: string;
  water: string;
};

export const products: Product[] = [
  { id: "findik", name: "Fındık", latin: "Corylus avellana", group: "Meyve", price: 185, size: "60–90 cm", image: "/images/hazelnut.jpg", note: "Geniş, dişli ve yuvarlak yaprak yapısıyla en net ayrılan fidan.", light: "Güneş / yarı gölge", water: "Düzenli" },
  { id: "arizona-servisi", name: "Arizona Servisi", latin: "Cupressus arizonica", group: "İbreli", price: 240, size: "80–110 cm", image: "/images/conifer.jpg", note: "Gri-mavi, füme yeşil sıralarda kuvvetli aday. Tür teslimatta teyit edilir.", light: "Tam güneş", water: "Az / orta" },
  { id: "leylandi", name: "Leylandi", latin: "× Cuprocyparis leylandii", group: "Çit", price: 210, size: "80–100 cm", image: "/images/conifer.jpg", note: "Koyu yeşil, konik ve hızlı gelişen çit fidanı. Sık perdeleme için uygun.", light: "Tam güneş", water: "Düzenli" },
  { id: "mazi", name: "Mazı", latin: "Thuja / Platycladus spp.", group: "Çit", price: 195, size: "70–100 cm", image: "/images/nursery.jpg", note: "Sık ve konik gelişen adaylar. Leylandi ile kesin ayrım yakından yapılır.", light: "Güneş / yarı gölge", water: "Orta" },
  { id: "ardic", name: "Ardıç", latin: "Juniperus spp.", group: "İbreli", price: 225, size: "50–80 cm", image: "/images/conifer.jpg", note: "Mavi-gri ve daha gevşek dallanan fidanlar bu grupta değerlendiriliyor.", light: "Tam güneş", water: "Az" },
  { id: "cam", name: "Çam", latin: "Pinus spp.", group: "İbreli", price: 260, size: "60–90 cm", image: "/images/conifer.jpg", note: "Uzun iğne yapraklı fidanlar. Alt tür, sipariş öncesi yakın çekimle doğrulanır.", light: "Tam güneş", water: "Az / orta" },
  { id: "kurtbagri", name: "Kurtbağrı Adayı", latin: "Ligustrum spp.", group: "Çit", price: 135, size: "40–60 cm", image: "/images/nursery.jpg", note: "Küçük ve sık yapraklı çit grubu. Satıştan önce yaprak detayıyla doğrulanır.", light: "Güneş / yarı gölge", water: "Orta" },
  { id: "yapraksiz-fidan", name: "Yapraksız Fidan", latin: "Tür seçimi için teyit gerekli", group: "Yaprak döken", price: 150, size: "90–130 cm", image: "/images/nursery.jpg", note: "Elma, armut, erik veya ceviz olasılığı var; sipariş öncesi tür teyidi yapılır.", light: "Türüne göre", water: "Türüne göre" },
];

export const formatPrice = (value: number) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(value);
