const labels: Record<string, string> = {
  'QG Galaxie':'银河队基地','Badge Phare':'灯塔徽章','Badge Glaçon':'冰雪徽章','Monde Distorsion':'毁坏的世界','Route Victoire':'冠军之路',
  'Badge Charbon':'煤炭徽章','Badge Forêt':'森林徽章','Badge Fantôme':'遗迹徽章','Badge Pavé':'圆石徽章','Badge Palustre':'湿地徽章','Badge Mine':'矿山徽章','Les Lacs':'湖泊事件',
  'Conseil 4 : Aaron':'四天王：阿柳','Conseil 4 : Terry':'四天王：菊野','Conseil 4 : Adrien':'四天王：大叶','Conseil 4 : Lucio':'四天王：悟松','Maître de la Ligue':'联盟冠军','Mont Abrupt':'严酷山',
  'Voilaroc':'帷幕市','Frimapic':'切锋市','Rivamar':'滨海市','Littorella':'真砂镇','Ligue Pokémon':'宝可梦联盟','Hôtel Grand Lac':'湖畔大饭店',
};
export function chapterLabel(text: string) { return labels[text] || text.replace(/^Salle(?: (\d+))?$/, (_,n)=>n?`联盟第 ${n} 房间`:'联盟训练家区').replace(/^Route (\d+)$/, '$1 号道路').replace(/^Chenal (\d+)$/, '$1 号水路'); }
