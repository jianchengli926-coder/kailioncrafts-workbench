
(function() {
  const PREFIX = 'kailion_ark_';
  const emailMap = {"p6_outdoorknives_001": "webcontact@crkt.com", "p6_outdoorknives_002": "通用邮箱推测为info@outdooredge.com", "p6_outdoorknives_003": "support@bokerusa.com", "p6_outdoorknives_004": "orders@survivalsupplies.com.au", "p6_outdoorknives_005": "info@tsg.ca", "p6_kitchenknives_001": "orders@messermeister.com", "p6_kitchenknives_002": "support@matsato.com", "p6_kitchenknives_003": "info@katogroup.eu", "p6_kitchenknives_004": "sales@kitchencraft.co.uk", "p6_kitchenknives_005": "info@kanetsune.com", "p6_professionalscissors_001": "support@hausandgarten.com", "p6_professionalscissors_002": "customerservice@acmeunited.com", "p6_professionalscissors_003": "germanyshop@gewesotopcut-solingen.com", "p6_professionalscissors_004": "mail@hairtechnic.co.uk", "p6_professionalscissors_005": "direct@locau.com", "p6_kitchenaccessories_001": "order@norpro.com", "p6_kitchenaccessories_002": "smulligan@haroldimport.com", "p6_kitchenaccessories_003": "info@harms-import.de", "p6_kitchenaccessories_004": "info@heatgrill.com.au", "p6_kitchenaccessories_005": "sales@dexam.co.uk"};
  
  const customers = JSON.parse(localStorage.getItem(PREFIX + 'customers') || '[]');
  let updated = 0;
  
  customers.forEach(c => {
    if (emailMap[c.id]) {
      if (!c.contact) c.contact = {};
      c.contact.email = emailMap[c.id];
      updated++;
    }
  });
  
  localStorage.setItem(PREFIX + 'customers', JSON.stringify(customers));
  console.log('Fixed emails for ' + updated + ' customers');
  return JSON.stringify({updated: updated, total: customers.length});
})();
