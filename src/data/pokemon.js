import DATA from './pokemon.json';
export { DATA };
  export const TYPES={normal:'一般',fire:'火',water:'水',electric:'电',grass:'草',ice:'冰',fighting:'格斗',poison:'毒',ground:'地面',flying:'飞行',psychic:'超能力',bug:'虫',rock:'岩石',ghost:'幽灵',dragon:'龙',dark:'恶',steel:'钢',fairy:'妖精'};
  // The game assigns distinct IDs and, for some forms, different types.
  const forms=[
    [35101,351,'太阳的样子','Forme Solaire','Sunny Form',['fire']],
    [35102,351,'雨水的样子','Forme Eau de Pluie','Rainy Form',['water']],
    [35103,351,'雪云的样子','Forme Blizzard','Snowy Form',['ice']],
    [38601,386,'攻击形态','Forme Attaque','Attack Forme'],
    [38602,386,'防御形态','Forme Défense','Defense Forme'],
    [38603,386,'速度形态','Forme Vitesse','Speed Forme'],
    [41201,412,'砂土蓑衣','Cape Sable','Sandy Cloak'],
    [41202,412,'垃圾蓑衣','Cape Déchet','Trash Cloak'],
    [41301,413,'砂土蓑衣','Cape Sable','Sandy Cloak',['bug','ground']],
    [41302,413,'垃圾蓑衣','Cape Déchet','Trash Cloak',['bug','steel']],
    [42201,422,'东海','Mer Orient','East Sea'],
    [42301,423,'东海','Mer Orient','East Sea'],
    [47901,479,'加热形态','Forme Chaleur','Heat Form',['electric','fire']],
    [47902,479,'清洗形态','Forme Lavage','Wash Form',['electric','water']],
    [47903,479,'结冰形态','Forme Froid','Frost Form',['electric','ice']],
    [47904,479,'旋转形态','Forme Hélice','Fan Form',['electric','flying']],
    [47905,479,'切割形态','Forme Tonte','Mow Form',['electric','grass']],
    [48701,487,'起源形态','Forme Originelle','Origin Forme'],
    [49201,492,'天空形态','Forme Céleste','Sky Forme',['grass','flying']],
    ...Object.entries({fire:'Feu',water:'Eau',grass:'Plante',electric:'Électrik',ice:'Glace',fighting:'Combat',poison:'Poison',ground:'Sol',flying:'Vol',psychic:'Psy',bug:'Insecte',rock:'Roche',ghost:'Spectre',dragon:'Dragon',dark:'Ténèbres',steel:'Acier'}).map(([type,fr],index)=>
      [49301+index,493,TYPES[type],fr,type,[type]])
  ];
  for(const [id,base,zh,fr,en,types] of forms){
    const d=DATA.dex[base];
    DATA.dex[id]={base,name:`${d.name} (${zh})`,fr:`${d.fr} (${fr})`,key:`${d.key.split('-')[0]} (${en})`,types:types||d.types};
  }
