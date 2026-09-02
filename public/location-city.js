(()=>{
  const API='https://api.bigdatacloud.net/data/reverse-geocode-client';
  let requestSerial=0;

  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

  function currentCoordinates(){
    const lat=document.querySelector('input[name="latitude"]')?.value;
    const lng=document.querySelector('input[name="longitude"]')?.value;
    const latitude=Number(lat),longitude=Number(lng);
    if(Number.isFinite(latitude)&&Number.isFinite(longitude)&&lat!==''&&lng!=='')return{latitude,longitude};
    return null;
  }

  async function waitForCoordinates(timeout=12000){
    const started=Date.now();
    while(Date.now()-started<timeout){
      const coords=currentCoordinates();
      if(coords)return coords;
      await sleep(120);
    }
    return null;
  }

  function regionCode(data){
    const code=String(data?.principalSubdivisionCode||'');
    if(code.includes('-'))return code.split('-').pop().toUpperCase();
    return String(data?.principalSubdivision||'').trim();
  }

  function cityName(data){
    const administrative=Array.isArray(data?.localityInfo?.administrative)?data.localityInfo.administrative:[];
    const municipality=administrative.find(item=>Number(item?.adminLevel)===8&&item?.name);
    if(municipality?.name)return String(municipality.name).trim();
    return String(data?.city||data?.locality||'').trim();
  }

  async function reverseGeocode(latitude,longitude){
    const url=new URL(API);
    url.searchParams.set('latitude',String(latitude));
    url.searchParams.set('longitude',String(longitude));
    url.searchParams.set('localityLanguage','pt');
    const response=await fetch(url.toString(),{method:'GET',mode:'cors',credentials:'omit',cache:'no-store'});
    if(!response.ok)throw new Error('Não foi possível identificar a cidade.');
    return response.json();
  }

  function applyPlace(data){
    const city=cityName(data),region=regionCode(data);
    if(!city)return false;
    const place=region?`${city} - ${region}`:city;

    document.querySelectorAll('#listingForm input[name="city"],#businessForm input[name="city"]').forEach(input=>{
      input.value=place;
      input.dataset.locationCity='1';
      delete input.dataset.autoLocationCity;
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
    });

    const status=document.querySelector('#locationStatus');
    if(status)status.textContent=`📍 ${place} • localização precisa`;

    document.querySelectorAll('.form-location-box').forEach(box=>{
      const note=box.querySelector(':scope > span');
      if(note)note.textContent=`✓ Localização adicionada • ${place}`;
    });

    return true;
  }

  async function resolveClickedLocation(button){
    const serial=++requestSerial;
    const status=document.querySelector('#locationStatus');
    if(status)status.textContent='📍 Identificando sua cidade...';

    const coords=await waitForCoordinates();
    if(serial!==requestSerial)return;
    if(!coords){
      if(status)status.textContent='📍 Localização precisa ativada';
      return;
    }

    try{
      const data=await reverseGeocode(coords.latitude,coords.longitude);
      if(serial!==requestSerial)return;
      if(!applyPlace(data)&&status)status.textContent='📍 Localização precisa ativada • cidade não identificada';
    }catch(error){
      console.warn('Falha ao identificar cidade pela localização',error);
      if(status)status.textContent='📍 Localização precisa ativada • cidade não identificada';
    }
  }

  document.addEventListener('click',event=>{
    const button=event.target.closest('#useLocationButton,.form-location-box button');
    if(!button)return;
    resolveClickedLocation(button);
  },true);
})();
