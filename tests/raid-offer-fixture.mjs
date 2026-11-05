// DOM contract of the audited native picker: no selection on Cancel, and the
// ally in the other slot is hidden. Can add real friend-shaped offers in tests.
export function installRaidOfferPickers() {
  for (const button of document.querySelectorAll('#raid-root [data-raid-slot]')) button.onclick = () => {
    const [region, index] = button.dataset.raidSlot.split('|'), save = JSON.parse(localStorage.getItem('gachamon-save-v1'));
    const offers = [...(window.fixtureFriends || []), ...(save.raids?.bots?.[region] || [])];
    const other = save.raids?.pick?.[region]?.[1 - Number(index)];
    const dialog = document.createElement('div'); dialog.className = 'modal dexcard-modal raid-dlg';
    dialog.innerHTML = '<button class="dc-x">关闭</button><div class="raid-scroll"></div>';
    dialog.querySelector('.dc-x').onclick = () => dialog.remove();
    for (const offer of offers.filter(o => o.key !== other)) {
      const row = document.createElement('button'); row.className = 'raid-pick'; row.dataset.pick = offer.key;
      row.innerHTML = `<span class="nm"><b>${offer.name}</b></span><span class="rt-mons">${offer.mons.map(m => `<span class="rt-mon"><img src="assets/pokemon/${m.shiny ? 'shiny/' : ''}${m.id}.png"><span class="rt-lv">Lv.${m.level}</span></span>`).join('')}</span>`;
      row.onclick = () => { throw new Error('Read-only collector must never select an offer'); };
      dialog.querySelector('.raid-scroll').append(row);
    }
    document.body.append(dialog);
  };
}
