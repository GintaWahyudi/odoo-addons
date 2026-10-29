from odoo import models


class PosSession(models.Model):
    _inherit = 'pos.session'

    def _loader_params_res_company(self):
        # Tambahkan field alamat perusahaan agar bisa dipakai di nota WhatsApp.
        params = super()._loader_params_res_company()
        fields = params['search_params']['fields']
        for field in ('street', 'street2', 'city', 'zip'):
            if field not in fields:
                fields.append(field)
        return params
