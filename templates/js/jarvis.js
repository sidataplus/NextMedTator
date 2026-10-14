/**
 * A manager for all kinds of tasks that we don't want core app to do
 * 
 * Hey Jarvis! It's not a voice command assistant.
 */
var jarvis = {
    // for annotating test
    sample_text: {},

    // for log
    changelog_latest: '',

    init: function() {
        // too bad ...
        if (isIE) { 
            this.ssmsg(_NOT_SUPPORT_MSG);
            return 0; 
        }

        app_hotpot.init();

        // File pickers are an optional enhancement. Safari/Firefox use ordinary
        // file inputs and downloads and must never be trapped behind an inline handler.
        jarvis.ssmsg('Ready');
        setTimeout(function() { jarvis.ssclose(); }, 500);
        document.addEventListener('click', function(event) {
            if (event.target.closest && event.target.closest('[data-nmt-action-link]')) event.preventDefault();
        });

        $(window).resize(function() {
            app_hotpot.resize();
        });

        // get some settings here

        // the default sample dataset for demo
        var sample_ds = this.get_url_paramter('ds');
        if (sample_ds == '') {
            sample_ds = 'MINIMAL_TASK';
        }

        // show sample dataset at beginning or not
        var show_sample = this.get_url_paramter('ss');
        if (show_sample == 'yes') {
            app_hotpot.vpp.load_sample_ds(sample_ds);
        }

        // show the tour?
        var show_tour = this.get_url_paramter('st');
        if (show_tour == 'yes') {
            setTimeout(function() { app_hotpot.start_tour_annotation(); }, 550);
        }
    },

    get_url_paramter: function(name) {
        name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
        var regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
        var results = regex.exec(location.search);
        return results === null ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
    },

    ssmsg: function(msg) {
        $('#ss-msg').html(msg);
    },

    ssclose: function() {
        $('#start-screen').hide();
    },

    save_json: function(obj, fn) {
        var json_text = JSON.stringify(obj, null, 4);
        var blob = new Blob([json_text], {type: "text/json;charset=utf-8"});
        saveAs(blob, fn);
    },

    save_vpp_as: function(name) {
        if (app_hotpot.vpp.$data.dtd == null) {
            console.log('* no dtd yet');
            return;
        }
        var dtd_name = app_hotpot.vpp.$data.dtd.name;

        if (typeof(name) == 'undefined') {
            name = dtd_name;
        }

        // change to upper case for better looking
        name = name.toLocaleUpperCase();

        // save it!
        this.save_json(
            app_hotpot.vpp.$data,
            'vpp_data_'+name+'.json'
        );
    }
}
