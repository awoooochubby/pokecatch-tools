const labels: Record<string, string> = {
  'Badge Roche':'岩石徽章','Badge Cascade':'蓝色徽章','Badge Foudre':'橙色徽章','Badge Prisme':'彩虹徽章','Badge Âme':'粉红徽章','Badge Marais':'金色徽章','Badge Volcan':'深红徽章','Badge Terre':'绿色徽章',
  'Badge Zéphyr':'飞翼徽章','Badge Essaim':'昆虫徽章','Badge Plaine':'标准徽章','Badge Brume':'魅影徽章','Badge Choc':'打击徽章','Badge Minéral':'钢铁徽章','Lac Colère':'愤怒之湖','Badge Glacier':'冰之徽章','Tour Radio':'广播塔','Badge Lever':'升龙徽章','Mont Argenté':'白银山',
  'Badge Roche (Hoenn)':'岩石徽章（丰缘）','Badge Poing':'拳击徽章','Badge Dynamo':'电力徽章','Badge Chaleur':'烈焰徽章','Mont Chimnée':'烟囱山','Badge Balance':'天秤徽章','Badge Plume':'白羽徽章','Mont Mémoria':'送神山','Badge Esprit':'心灵徽章','La crise':'天地异变','Badge Pluie':'雨滴徽章',
  'Caverne Azurée':'华蓝洞窟','Îles Écume':'双子岛','Centrale':'无人发电厂','Mont Braise':'灯火山','Tour Ferraille':'铃铛塔','Tourb’Îles':'漩涡列岛','Ruines Alpha':'阿露福遗迹','Bois aux Chênes':'桐树林','Île du Sud':'南方孤岛','Grotte Marine':'海之窟','Grotte Terra':'陆之窟','Pilier Céleste':'天空之柱','Île de Fer':'钢铁岛','Temple Frimapic':'雪峰神殿','Île Pleine Lune':'满月岛','Île Nouvellune':'新月岛','Paradis Fleuri':'花之乐园',
  'QG Galaxie':'银河队基地','Badge Phare':'灯塔徽章','Badge Glaçon':'冰雪徽章','Monde Distorsion':'毁坏的世界','Route Victoire':'冠军之路',
  'Badge Charbon':'煤炭徽章','Badge Forêt':'森林徽章','Badge Fantôme':'遗迹徽章','Badge Pavé':'圆石徽章','Badge Palustre':'湿地徽章','Badge Mine':'矿山徽章','Les Lacs':'湖泊事件',
  'Conseil 4 : Aaron':'四天王：阿柳','Conseil 4 : Terry':'四天王：菊野','Conseil 4 : Adrien':'四天王：大叶','Conseil 4 : Lucio':'四天王：悟松','Maître de la Ligue':'联盟冠军','Mont Abrupt':'严酷山',
  'Voilaroc':'帷幕市','Frimapic':'切锋市','Rivamar':'滨海市','Littorella':'真砂镇','Ligue Pokémon':'宝可梦联盟','Hôtel Grand Lac':'湖畔大饭店',
};
export function chapterLabel(text: string) { return labels[text] || text.replace(/^Salle(?: (\d+))?$/, (_,n)=>n?`联盟第 ${n} 房间`:'联盟训练家区').replace(/^Route (\d+)$/, '$1 号道路').replace(/^Chenal (\d+)$/, '$1 号水路'); }
